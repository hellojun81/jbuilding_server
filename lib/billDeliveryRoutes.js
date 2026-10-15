import express from 'express';
import { getCommonDetails, validateCommonDetails, billDetails } from './billDetails.js';
import { getBillNotice } from './billNotice.js';
import crypto from 'node:crypto';
import defaultDatabase from './CRUD.js';
import { normalizeQueryRows } from './queryRows.js';
import { buildBillDelivery, sendBillChannel } from './billDeliverySender.js';
export function createBillDeliveryRouter({ database = defaultDatabase, send = sendBillChannel, build = buildBillDelivery } = {}) {
const sql = database;
const router = express.Router();
function period(input) {
  if (!/^\d{4}$/.test(String(input.year)) || !/^(0[1-9]|1[0-2])$/.test(String(input.month))) {
    throw Object.assign(new Error('청구 연월을 확인해 주세요.'), { status: 400 });
  }
  return [String(input.year), String(input.month)];
}
async function loadPlan(query, name, year, month, lock = false, note, details) {
  if (note !== undefined && (typeof note !== 'string' || note.length > 2000)) throw Object.assign(new Error('비고는 2,000자 이내로 입력해 주세요.'), { status: 400 });
  const [rows] = await query(`SELECT a.key_code, a.name, a.address, a.building_name, a.bill_delivery_method, a.email, a.tel, a.etc AS contract_note,
    b.rent_bill, b.mng_bill, b.vat_bill, b.water_bill, b.other_bill, b.other_vat_bill, b.etc
    FROM jbuildingmng a JOIN jbuildingrentbill b ON a.key_code = b.comp_code
    WHERE a.name = ? AND a.dealYN = 'Y' AND b.year = ? AND b.month = ?${lock ? ' FOR UPDATE' : ''}`, [name, year, month]);
  if (rows.length !== 1) throw Object.assign(new Error('저장된 청구서를 먼저 생성하거나 확인해 주세요.'), { status: 400 });
  const bill = normalizeQueryRows(rows)[0];
  bill.etc = [bill.contract_note, note === undefined ? bill.etc : note].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join('\n');
  const notice = await getBillNotice(query);
  bill.deliveryDetails = { ...await getCommonDetails(query), ...billDetails(details, bill, year, month) };
  return { bill, plan: build(bill, year, month, { ...process.env, BILL_COMMON_NOTICE: notice }) };
}
async function history(query, code, year, month) {
  const [rows] = await query('SELECT channel, status, receipt, error_message, created_at FROM bill_deliveries WHERE comp_code = ? AND bill_year = ? AND bill_month = ?', [code, year, month]);
  return normalizeQueryRows(rows);
}
router.get('/settings', async (req, res, next) => {
  try { res.json({ notice: await getBillNotice(sql.query), ...await getCommonDetails(sql.query) }); } catch (error) { next(error); }
});
router.put('/settings', async (req, res, next) => {
  try {
    const details = validateCommonDetails(req.body);
    const notice = req.body.notice;
    if (typeof notice !== 'string' || notice.length > 1000) throw Object.assign(new Error('공통 안내 문구는 1,000자 이내로 입력해 주세요.'), { status: 400 });
    await sql.query('INSERT INTO bill_settings (id, notice) VALUES (1, ?) ON DUPLICATE KEY UPDATE notice = VALUES(notice)', [notice.trim()]);
    await sql.query('INSERT INTO bill_detail_settings (id, details_json) VALUES (1, ?) ON DUPLICATE KEY UPDATE details_json = VALUES(details_json)', [JSON.stringify(details)]);
    res.json({ notice: notice.trim(), ...details });
  } catch (error) { next(error); }
});
router.get('/delivery-history', async (req, res, next) => {
  try {
    const [year, month] = period(req.query);
    const channel = req.query.channel || '';
    const status = req.query.status || '';
    const page = Number(req.query.page || 0);
    if (!['', 'email', 'sms', 'kakao'].includes(channel) || !['', 'queued', 'submitted', 'unknown'].includes(status) || !Number.isSafeInteger(page) || page < 0 || page > 100000) {
      throw Object.assign(new Error('조회 조건을 확인해 주세요.'), { status: 400 });
    }
    const conditions = ['d.bill_year = ?', 'd.bill_month = ?'];
    const params = [year, month];
    if (channel) { conditions.push('d.channel = ?'); params.push(channel); }
    if (status) { conditions.push('d.status = ?'); params.push(status); }
    const where = conditions.join(' AND ');
    const [counts] = await sql.query(`SELECT COUNT(*) AS total FROM bill_deliveries d WHERE ${where}`, params);
    const [rows] = await sql.query(`SELECT d.id, d.comp_code, COALESCE(a.name, d.comp_code) AS renter_name,
      d.bill_year, d.bill_month, d.channel, d.recipient, d.status, d.receipt, d.error_message, d.created_at
      FROM bill_deliveries d LEFT JOIN jbuildingmng a ON a.key_code = d.comp_code
      WHERE ${where} ORDER BY d.created_at DESC, d.id DESC LIMIT 20 OFFSET ?`, [...params, page * 20]);
    res.json({ rows: normalizeQueryRows(rows), total: Number(counts[0].total), page });
  } catch (error) { next(error); }
});
router.get('/delivery-history/:id', async (req, res, next) => {
  try {
    if (!/^[1-9]\d{0,19}$/.test(req.params.id)) throw Object.assign(new Error('발송 내역 번호를 확인해 주세요.'), { status: 400 });
    const [rows] = await sql.query(`SELECT d.id, d.comp_code, COALESCE(a.name, d.comp_code) AS renter_name,
      d.bill_year, d.bill_month, d.channel, d.recipient, d.status, d.receipt, d.error_message, d.created_at, d.content_text
      FROM bill_deliveries d LEFT JOIN jbuildingmng a ON a.key_code = d.comp_code WHERE d.id = ?`, [req.params.id]);
    if (!rows.length) throw Object.assign(new Error('발송 내역을 찾을 수 없습니다.'), { status: 404 });
    res.json(normalizeQueryRows(rows)[0]);
  } catch (error) { next(error); }
});
router.route('/:renter/delivery-preview').get(previewDelivery).post(previewDelivery);
async function previewDelivery(req, res, next) {
  try {
    const input = req.method === 'POST' ? req.body : req.query;
    const [year, month] = period(input);
    const { bill, plan } = await loadPlan(sql.query, req.params.renter, year, month, false, input.note, input.details);
    res.json({ ...plan, history: await history(sql.query, bill.key_code, year, month) });
  } catch (error) { next(error); }
}
router.post('/:renter/deliver', async (req, res, next) => {
  try {
    if (req.body.confirmation !== 'SEND_BILL') throw Object.assign(new Error('청구서 실제 발송 확인이 필요합니다.'), { status: 400 });
    const [year, month] = period(req.body);
    const reserved = await sql.transaction(async (query) => {
      const { bill, plan } = await loadPlan(query, req.params.renter, year, month, true, req.body.note, req.body.details);
      if (plan.revision !== req.body.revision) throw Object.assign(new Error('청구 금액·수신방법·설정이 변경되었습니다. 미리보기를 다시 확인해 주세요.'), { status: 409 });
      const previous = await history(query, bill.key_code, year, month);
      const channels = plan.channels.filter((item) => !previous.some((row) => row.channel === item.channel));
      if (!channels.length) throw Object.assign(new Error('발송할 채널이 없거나 이미 처리된 청구서입니다. 기존 발송 결과를 확인해 주세요.'), { status: 409 });
      if (channels.some((item) => !item.ready)) throw Object.assign(new Error('수신 연락처 또는 발송 설정을 확인해 주세요.'), { status: 400 });
      for (const channel of channels) {
        channel.requestId = crypto.randomBytes(16).toString('hex');
        await query(`INSERT INTO bill_deliveries (comp_code, bill_year, bill_month, channel, request_id, recipient, content_text, revision, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued')`, [bill.key_code, year, month, channel.channel, channel.requestId, channel.recipient, channel.content, plan.revision]);
      }
      return { bill, plan, channels };
    });
    const results = [];
    for (const channel of reserved.channels) {
      let status = 'unknown'; let receipt = ''; let errorMessage = '';
      try {
        const sent = await send({ plan: reserved.plan, channel, recipientName: reserved.bill.name, requestId: channel.requestId });
        status = 'submitted'; receipt = sent.receipt;
      } catch (error) {
        // Provider may have accepted the message before a timeout: never auto-retry.
        errorMessage = `발송 결과 확인 필요${typeof error.code === 'number' ? ` (코드 ${error.code})` : ''}. 발송사업자 내역을 확인해 주세요.`;
      }
      await sql.query('UPDATE bill_deliveries SET status = ?, receipt = ?, error_message = ? WHERE request_id = ?', [status, receipt, errorMessage, channel.requestId]);
      results.push({ channel: channel.channel, status, receipt, error: errorMessage });
    }
    res.json({ results, message: '채널별 접수 결과를 확인해 주세요. 발송 접수는 최종 수신 완료를 의미하지 않습니다.' });
  } catch (error) { next(error); }
});
return router;
}
export default createBillDeliveryRouter();
