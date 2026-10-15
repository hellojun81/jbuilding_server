const fail = (message) => { throw Object.assign(new Error(message), { status: 400 }); };
export function validateCommonDetails(input = {}) {
 const result = {};
 for (const key of ['bank', 'account', 'accountHolder', 'contact']) {
  const value = input[key] ?? '';
  if (typeof value !== 'string' || value.length > 150) fail('계좌 및 문의 정보는 각 150자 이내로 입력해 주세요.');
  result[key] = value.trim();
 }
 return result;
}
export async function getCommonDetails(query) {
 const [rows] = await query('SELECT details_json FROM bill_detail_settings WHERE id = 1');
 return validateCommonDetails(rows[0]?.details_json ? JSON.parse(String(rows[0].details_json)) : {});
}
export function billDetails(input = {}, bill, year, month) {
 if (!input || typeof input !== 'object' || Array.isArray(input)) fail('청구서 추가 정보를 확인해 주세요.');
 const end = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
 const start = `${year}-${month}-01`, last = `${year}-${month}-${end}`;
 const date = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) fail('유효한 날짜를 입력해 주세요.');
  return value;
 };
 const result = { dueDate: date(input.dueDate ?? last), periodStart: date(input.periodStart ?? start), periodEnd: date(input.periodEnd ?? last), room: input.room ?? String(bill.address || ''), arrears: Number(input.arrears ?? 0) };
 if (result.periodStart > result.periodEnd) fail('청구 시작일은 종료일보다 늦을 수 없습니다.');
 if (typeof result.room !== 'string' || result.room.length > 150) fail('호실은 150자 이내로 입력해 주세요.');
 if (!['number', 'string'].includes(typeof (input.arrears ?? 0)) || !Number.isSafeInteger(result.arrears) || result.arrears < 0) fail('미납금은 0 이상의 정수로 입력해 주세요.');
 return result;
}
