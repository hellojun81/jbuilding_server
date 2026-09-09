const validTransactionTypes = new Set(['all', 'deposit', 'withdrawal']);

function parseDate(value, fieldName) {
  const compact = String(value || '').replace(/-/g, '');
  if (!/^\d{8}$/.test(compact)) {
    throw Object.assign(new Error(`${fieldName} 형식이 올바르지 않습니다.`), { status: 400 });
  }
  const parsed = new Date(Date.UTC(
    Number(compact.slice(0, 4)),
    Number(compact.slice(4, 6)) - 1,
    Number(compact.slice(6, 8)),
  ));
  if (parsed.toISOString().slice(0, 10).replace(/-/g, '') !== compact) {
    throw Object.assign(new Error(`${fieldName}가 올바른 날짜가 아닙니다.`), { status: 400 });
  }
  return {
    compact,
    sql: `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`,
    date: parsed,
  };
}

export function bankLedgerFilters(query = {}) {
  const start = parseDate(query.startDate, '조회 시작일');
  const end = parseDate(query.endDate, '조회 종료일');
  const days = Math.round((end.date - start.date) / 86400000) + 1;
  if (days < 1 || days > 366) {
    throw Object.assign(new Error('전체 거래내역 조회 기간은 최대 1년입니다.'), { status: 400 });
  }
  const transactionType = String(query.type || 'all');
  if (!validTransactionTypes.has(transactionType)) {
    throw Object.assign(new Error('거래 구분이 올바르지 않습니다.'), { status: 400 });
  }
  const search = String(query.search || '').trim();
  if (search.length > 100) {
    throw Object.assign(new Error('검색어는 100자 이하로 입력해 주세요.'), { status: 400 });
  }
  return { startDate: start.sql, endDate: end.sql, transactionType, search };
}

export function bankLedgerWhere(filters) {
  const conditions = ['t.trade_date >= ?', 't.trade_date <= ?'];
  const values = [filters.startDate, filters.endDate];
  if (filters.transactionType === 'deposit') conditions.push('t.deposit_amount > 0');
  else if (filters.transactionType === 'withdrawal') conditions.push('t.withdrawal_amount > 0');
  else conditions.push('(t.deposit_amount > 0 OR t.withdrawal_amount > 0)');
  if (filters.search) {
    conditions.push(`CONCAT_WS(' ', t.remark1, t.remark2, t.remark3, t.remark4, t.memo) LIKE ?`);
    values.push(`%${filters.search}%`);
  }
  return { whereSql: conditions.join(' AND '), values };
}
