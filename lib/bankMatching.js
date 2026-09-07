export function normalizeMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/주식회사|\(주\)|㈜/g, '')
    .replace(/[^0-9a-z가-힣]/g, '');
}

export function billTotal(bill) {
  return ['rent_bill', 'mng_bill', 'vat_bill', 'water_bill', 'other_bill', 'other_vat_bill']
    .reduce((sum, key) => sum + Number(bill[key] || 0), 0);
}

export function matchCandidates(transaction, bills, { preferredRenterCode = '' } = {}) {
  const depositAmount = Number(transaction.deposit_amount || 0);
  const transactionText = normalizeMatchText([
    transaction.remark1, transaction.remark2, transaction.remark3, transaction.remark4, transaction.memo,
  ].join(' '));
  const candidates = bills
    .map((bill) => {
      const name = normalizeMatchText(bill.renter_name);
      const nameMatched = name.length >= 2 && transactionText.includes(name);
      const learnedMatch = String(bill.renter_code) === String(preferredRenterCode || '');
      const amount = billTotal(bill);
      const exactAmount = amount === depositAmount;
      const billYear = String(bill.bill_year || '');
      const billMonth = String(bill.bill_month || '').padStart(2, '0');
      return {
        candidateKey: `${bill.renter_code}:${billYear}-${billMonth}`,
        renterCode: String(bill.renter_code),
        renterName: String(bill.renter_name),
        billYear,
        billMonth,
        amount,
        difference: depositAmount - amount,
        exactAmount,
        nameMatched,
        learnedMatch,
        confidence: exactAmount
          ? (learnedMatch ? 'learned' : (nameMatched ? 'high' : 'amount'))
          : 'manual',
      };
    })
    .sort((left, right) => Number(right.exactAmount) - Number(left.exactAmount)
      || Number(right.learnedMatch) - Number(left.learnedMatch)
      || Number(right.nameMatched) - Number(left.nameMatched)
      || Math.abs(left.difference) - Math.abs(right.difference)
      || `${right.billYear}${right.billMonth}`.localeCompare(`${left.billYear}${left.billMonth}`)
      || left.renterName.localeCompare(right.renterName, 'ko'));
  const exactCandidates = candidates.filter((candidate) => candidate.exactAmount);
  const learned = exactCandidates.filter((candidate) => candidate.learnedMatch);
  const named = exactCandidates.filter((candidate) => candidate.nameMatched);
  return {
    candidates,
    suggested: learned.length === 1
      ? learned[0]
      : (named.length === 1
        ? named[0]
        : (named.length === 0 && exactCandidates.length === 1 ? exactCandidates[0] : null)),
  };
}
