import crypto from 'node:crypto';
import { normalizeQueryRows } from './queryRows.js';
const conflict = (message) => Object.assign(new Error(message), { status: 409 });
export function billDeletionRevision(row) {
  return crypto.createHash('sha256').update(JSON.stringify(normalizeQueryRows([row])[0])).digest('hex');
}
export async function archiveAndDeleteBill(query, { code, year, month, revision, renter }) {
  const args = [code, year, month];
  const [rows] = await query('SELECT * FROM jbuildingrentbill WHERE comp_code = ? AND year = ? AND month = ? FOR UPDATE', args);
  if (rows.length !== 1) throw conflict('삭제할 청구서가 없거나 중복되어 있습니다. 새로고침해 주세요.');
  const bill = normalizeQueryRows(rows)[0];
  if (billDeletionRevision(bill) !== revision) throw conflict('청구 내용이 변경되었습니다. 다시 확인해 주세요.');
  if (bill.finish === 'Y') throw conflict('수납 완료된 청구서는 삭제할 수 없습니다. 수납 상태를 먼저 확인해 주세요.');
  const guards = [
    ['bank_bill_matches', '입금이 연결된 청구서는 삭제할 수 없습니다. 은행내역 연결을 먼저 확인해 주세요.'],
    ['tax_invoice_issues', '세금계산서 발행 이력이 있어 삭제할 수 없습니다.'],
    ['bill_deliveries', '청구서 발송 이력이 있어 삭제할 수 없습니다. 수신자에게 보낸 내역을 먼저 확인해 주세요.'],
  ];
  for (const [table, message] of guards) {
    const [linked] = await query(`SELECT id FROM ${table} WHERE comp_code = ? AND bill_year = ? AND bill_month = ? FOR UPDATE`, args);
    if (linked.length) throw conflict(message);
  }
  await query('INSERT INTO deleted_bills (comp_code, bill_year, bill_month, renter_name, snapshot_json) VALUES (?, ?, ?, ?, ?)', [...args, renter, JSON.stringify(bill)]);
  const [result] = await query('DELETE FROM jbuildingrentbill WHERE comp_code = ? AND year = ? AND month = ?', args);
  if (result.affectedRows !== 1) throw conflict('삭제 대상이 변경되었습니다.');
  return result.affectedRows;
}
