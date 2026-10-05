const fields = ['rent_bill', 'mng_bill', 'vat_bill', 'water_bill', 'other_bill', 'other_vat_bill'];
export function validateBillingAmounts(data, current = {}) {
  if (!fields.some((key) => Object.hasOwn(data, key))) return data;
  const merged = { ...current, ...data };
  const amounts = Object.fromEntries(fields.map((key) => {
    const raw = merged[key] ?? 0;
    const value = Number(raw);
    if (!['string', 'number'].includes(typeof raw) || !Number.isSafeInteger(value) || value < 0) {
      throw Object.assign(new Error(`${key}: 금액은 0 이상의 정수로 입력해 주세요.`), { status: 400 });
    }
    return [key, value];
  }));
  const expected = {
    vat_bill: Math.round(amounts.rent_bill * 0.1) + Math.round(amounts.mng_bill * 0.1),
    other_vat_bill: Math.round(amounts.other_bill * 0.1),
  };
  for (const [key, value] of Object.entries(expected)) {
    if (Object.hasOwn(data, key) && amounts[key] !== value) {
      throw Object.assign(new Error(`${key === 'vat_bill' ? '부가세' : '기타 부가세'}가 공급가액과 일치하지 않습니다. 계산 금액 ${value.toLocaleString('ko-KR')}원으로 확인 후 다시 저장해 주세요.`), { status: 400 });
    }
  }
  const result = { ...data, ...amounts, ...expected };
  if (!Number.isSafeInteger(fields.reduce((sum, key) => sum + result[key], 0))) {
    throw Object.assign(new Error('합계 금액이 허용 범위를 초과했습니다.'), { status: 400 });
  }
  return result;
}
