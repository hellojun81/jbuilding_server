export const defaultBillNotice = '연체 시 미납금액의 5%에 해당하는 연체요금이 발생합니다.';
export async function getBillNotice(query) {
  const [rows] = await query("SELECT notice FROM bill_settings WHERE id = 1");
  const value = rows[0]?.notice;
  return value === undefined ? defaultBillNotice : Buffer.isBuffer(value) ? value.toString('utf8') : value;
}
