import crypto from 'node:crypto';
import { billDetails } from './billDetails.js';
import { defaultBillNotice } from './billNotice.js';
import nodemailer from 'nodemailer';
import popbill from 'popbill';
import { billDeliveryPlan } from './billDelivery.js';
import { validateBillingAmounts } from './billingAmounts.js';

const amountFields = ['rent_bill', 'mng_bill', 'vat_bill', 'water_bill', 'other_bill', 'other_vat_bill'];
const labels = ['임대료', '관리비', '부가세', '수도료(면세)', '기타요금', '기타 부가세'];
const money = (n) => Number(n).toLocaleString('ko-KR');
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function senderSettings(channel, env = process.env) {
  const keys = channel === 'email' ? ['SMTP_USER', 'SMTP_APP_PASSWORD']
    : ['POPBILL_LINK_ID', 'POPBILL_SECRET_KEY', 'POPBILL_CORP_NUM', 'POPBILL_USER_ID', 'BILL_SMS_SENDER',
      ...(channel === 'kakao' ? ['BILL_KAKAO_TEMPLATE_CODE', 'BILL_KAKAO_TEMPLATE_TEXT'] : [])];
  const missing = keys.filter((key) => !String(env[key] || '').trim());
  return { configured: missing.length === 0, enabled: env.BILL_DELIVERY_ENABLED === 'true', missing };
}
export function renderKakao(template, variables) {
  return String(template || '').replace(/\\n/g, '\n').replace(/#\{([^}]+)\}/g, (_, name) => {
    if (!Object.hasOwn(variables, name)) throw Object.assign(new Error(`카카오 템플릿 변수 확인 필요: ${name}`), { status: 400 });
    return variables[name];
  });
}
export function buildBillDelivery(bill, year, month, env = process.env) {
  const amounts = validateBillingAmounts(Object.fromEntries(amountFields.map((key) => [key, bill[key] ?? 0])));
  const total = amountFields.reduce((sum, key) => sum + amounts[key], 0);
  if (total <= 0) throw Object.assign(new Error('청구 합계는 0원보다 커야 합니다.'), { status: 400 });
  const notice = env.BILL_COMMON_NOTICE ?? defaultBillNotice;
  const displayFields = amountFields.filter((key) => key !== 'other_vat_bill');
  const displayAmount = (key) => key === 'other_bill' ? amounts.other_bill + amounts.other_vat_bill : amounts[key];
  const displayLabel = (key) => key === 'other_bill' && amounts.other_vat_bill ? '기타요금(부가세 포함)' : labels[amountFields.indexOf(key)];
  const details = bill.deliveryDetails || billDetails({}, bill, year, month);
  const payable = total + details.arrears;
  if (!Number.isSafeInteger(payable)) throw Object.assign(new Error('납부 합계가 허용 범위를 초과했습니다.'), {status:400});
  const recipientTitle = `${bill.name}${details.room ? ` (${details.room})` : ''}`;
  const periodText = `청구 대상 기간: ${details.periodStart} ~ ${details.periodEnd}`;
  const detailText = [`호실: ${details.room || '-'}`, `청구 대상 기간: ${details.periodStart} ~ ${details.periodEnd}`, `납부기한: ${details.dueDate}`, `당월 청구액: ${money(total)}원`, `이전 미납금: ${money(details.arrears)}원`, `총 납부금액: ${money(payable)}원`, `입금계좌: ${[details.bank, details.account].filter(Boolean).join(' ') || '미설정'}`, `예금주: ${details.accountHolder || '미설정'}`, `문의 연락처: ${details.contact || '미설정'}`].join('\n');
  const plan = billDeliveryPlan(bill);
  const period = `${year}년 ${month}월`;
  const title = `${bill.building_name || '제이빌딩'} ${period} 임대료 청구서`;
  const variables = { 상호: recipientTitle, 청구월: period, 합계: money(total),
    임대료: money(amounts.rent_bill), 관리비: money(amounts.mng_bill), 부가세: money(amounts.vat_bill),
    수도료: money(amounts.water_bill), 기타요금: money(amounts.other_bill), 기타부가세: money(amounts.other_vat_bill),
    청구정보: detailText, 비고: String(bill.etc || ''), 공통안내: notice, 입금안내: env.BILL_PAYMENT_NOTICE || '', 건물명: String(bill.building_name || '제이빌딩') };
  const paymentText = detailText.split('\n').slice(2).join('\n');
  const text = [title, `${recipientTitle} 귀하`, '', periodText,
    ...displayFields.map((key) => `${displayLabel(key)}: ${money(displayAmount(key))}원`),
    `합계: ${money(total)}원`, '', '[납부 안내]', paymentText,
    env.BILL_PAYMENT_NOTICE || '', '', `비고: ${String(bill.etc || '').trim() || '-'}`, notice].join('\n');
  const channels = plan.recipients.map((recipient) => {
    const settings = senderSettings(recipient.channel, env);
    let content = text;
    let templateError = '';
    if (recipient.channel === 'kakao') {
      try { content = renderKakao(env.BILL_KAKAO_TEMPLATE_TEXT, variables); }
      catch (error) { templateError = error.message; }
      if (!String(env.BILL_KAKAO_TEMPLATE_TEXT || '').includes('#{청구정보}')) templateError = '카카오 템플릿에 #{청구정보} 변수가 필요합니다.';
      if (notice && !String(env.BILL_KAKAO_TEMPLATE_TEXT || '').includes('#{공통안내}')) templateError = '카카오 템플릿에 #{공통안내} 변수가 필요합니다.';
      if (bill.etc && !String(env.BILL_KAKAO_TEMPLATE_TEXT || '').includes('#{비고}')) templateError = '카카오 템플릿에 #{비고} 변수가 필요합니다.';
      if (!String(env.BILL_KAKAO_TEMPLATE_TEXT || '').includes('#{합계}')) templateError = '카카오 템플릿에 #{합계} 변수가 필요합니다.';
    }
    return { ...recipient, ...settings, content, templateError,
      ready: recipient.valid && settings.configured && settings.enabled && !templateError };
  });
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#f3f5f8;color:#182433;font-family:Arial,'Malgun Gothic',sans-serif;line-height:1.7">
<div style="max-width:640px;margin:24px auto;padding:32px;background:#fff;border:1px solid #dce3eb;border-radius:12px">
<p style="margin:0;color:#53657a;font-size:14px">${escapeHtml(title)}</p>
<h1 style="font-size:26px;margin:8px 0 24px">${escapeHtml(recipientTitle)} 귀하</h1>
<p style="padding:12px 16px;background:#eef4fa;border-radius:6px;font-weight:bold;margin-bottom:0">${escapeHtml(periodText)}</p>
<table style="width:100%;border-collapse:collapse;font-size:16px" aria-label="청구 금액">
${displayFields.map((key) => `<tr><th style="text-align:left;padding:12px 16px;border-bottom:1px solid #e5eaf0;font-weight:normal">${displayLabel(key)}</th><td style="text-align:right;padding:12px 16px;border-bottom:1px solid #e5eaf0;font-variant-numeric:tabular-nums">${money(displayAmount(key))}원</td></tr>`).join('')}
</table>
<div style="padding:18px 16px;margin-top:20px;background:#eef4fa;border-radius:8px">
<div>당월 청구액: ${money(total)}원</div><div>이전 미납금: ${money(details.arrears)}원</div>
<div style="font-size:24px;font-weight:bold;color:#174b82;margin-top:8px">총 납부금액: ${money(payable)}원</div>
<div style="font-weight:bold">납부기한: ${escapeHtml(details.dueDate)}</div></div>
<h2 style="font-size:18px;margin:24px 0 8px">입금 및 문의 안내</h2>
<div>입금계좌: ${escapeHtml([details.bank, details.account].filter(Boolean).join(' ') || '미설정')}</div>
<div>예금주: ${escapeHtml(details.accountHolder || '미설정')}</div><div>문의 연락처: ${escapeHtml(details.contact || '미설정')}</div>
<p style="white-space:pre-wrap">${escapeHtml(env.BILL_PAYMENT_NOTICE || '')}</p>
<div style="border-top:1px solid #dce3eb;margin-top:24px;padding-top:16px;white-space:pre-wrap">비고: ${escapeHtml(String(bill.etc || '').trim() || '-')}</div>
<p style="white-space:pre-wrap;color:#53657a;font-size:14px">${escapeHtml(notice)}</p>
</div></body></html>`;
  const revision = crypto.createHash('sha256').update(JSON.stringify({ year, month, code: bill.key_code, method: plan.method,
    title, html, channels, sender: env.SMTP_USER, phone: env.BILL_SMS_SENDER, template: env.BILL_KAKAO_TEMPLATE_CODE })).digest('hex');
  return { details, payable, method: plan.method, label: plan.label, title, total, text, html, channels, revision };
}
function sdkCall(invoke) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('발송 응답 시간 초과')), 30000);
    try { invoke((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); }); }
    catch (error) { clearTimeout(timer); reject(error); }
  });
}
export async function sendBillChannel({ plan, channel, recipientName, requestId }, env = process.env) {
  if (!channel.ready || env.BILL_DELIVERY_ENABLED !== 'true') throw new Error('발송 설정이 준비되지 않았습니다.');
  if (channel.channel === 'email') {
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: env.SMTP_USER, pass: env.SMTP_APP_PASSWORD },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000 });
    try {
      const result = await transporter.sendMail({ from: env.SMTP_USER, to: channel.recipient,
        subject: plan.title, text: channel.content, html: plan.html,
        attachments: [{ filename: '청구서.html', content: plan.html, contentType: 'text/html; charset=utf-8' }] });
      if (!result.accepted?.length) throw new Error('메일 서버 수신 거부');
      return { receipt: result.messageId };
    } finally { transporter.close(); }
  }
  popbill.config({ LinkID: env.POPBILL_LINK_ID, SecretKey: env.POPBILL_SECRET_KEY, IsTest: false,
    IPRestrictOnOff: true, UseStaticIP: false, UseLocalTimeYN: true });
  const corp = env.POPBILL_CORP_NUM;
  const user = env.POPBILL_USER_ID;
  const receipt = channel.channel === 'sms'
    ? await sdkCall((ok, fail) => popbill.MessageService().sendLMS(corp, env.BILL_SMS_SENDER, channel.recipient, recipientName,
      plan.title, channel.content, '', false, '', requestId, user, ok, fail))
    : await sdkCall((ok, fail) => popbill.KakaoService().sendATS_multi(corp, env.BILL_KAKAO_TEMPLATE_CODE, env.BILL_SMS_SENDER,
      '', '', [{ rcv: channel.recipient, rcvnm: recipientName, msg: channel.content }], user, requestId, [], ok, fail));
  return { receipt: String(receipt) };
}
