import crypto from 'node:crypto';

export function taxDocumentData(row, year, month) {
  const rentSupply = Number(row.rent_supply || 0);
  const managementSupply = Number(row.management_supply || 0);
  const otherSupply = Number(row.other_supply || 0);
  const rentVat = Math.round(rentSupply * 0.1);
  const managementVat = Math.round(managementSupply * 0.1);
  const otherVat = Number(row.other_vat || 0);
  const storedBaseVat = Number(row.base_vat || 0);
  const waterSupply = Number(row.water_supply || 0);
  const taxableSupply = rentSupply + managementSupply + otherSupply;
  const taxableVat = storedBaseVat + otherVat;
  const taxableTotal = taxableSupply + taxableVat;
  const documents = [
    {
      document_type: 'tax_invoice',
      tax_type: '과세',
      supply_amount: taxableSupply,
      vat_amount: taxableVat,
      total_amount: taxableTotal,
      items: [
        { name: '임대료', supply_amount: rentSupply, vat_amount: rentVat },
        { name: '관리비', supply_amount: managementSupply, vat_amount: managementVat },
        ...(otherSupply || otherVat
          ? [{ name: '기타요금', supply_amount: otherSupply, vat_amount: otherVat }]
          : []),
      ],
    },
  ];
  if (waterSupply !== 0) {
    documents.push({
      document_type: 'invoice',
      tax_type: '면세',
      supply_amount: waterSupply,
      vat_amount: 0,
      total_amount: waterSupply,
      items: [{ name: '수도료', supply_amount: waterSupply, vat_amount: 0 }],
    });
  }
  return {
    ...row,
    year,
    month,
    rent_supply: rentSupply,
    rent_vat: rentVat,
    management_supply: managementSupply,
    management_vat: managementVat,
    other_supply: otherSupply,
    other_vat: otherVat,
    supply_amount: taxableSupply,
    vat_amount: taxableVat,
    total_amount: taxableTotal,
    exempt_amount: waterSupply,
    document_count: documents.length,
    documents,
    base_vat_matches: storedBaseVat === rentVat + managementVat,
  };
}


function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export function applyAmountBasis(source, basis = '', payment) {
  if (!['', 'billed', 'paid'].includes(basis)) throw invalid('청구 금액 또는 입금 금액을 선택해 주세요.');
  const target = structuredClone(source);
  target.amount_basis = basis;
  target.billed_amount = source.total_amount + source.exempt_amount;
  target.paid_amount = payment ? Number(payment.deposit_amount) : null;
  target.payment_available = Boolean(payment && Number.isSafeInteger(target.paid_amount) && target.paid_amount > 0);
  if (basis) {
    if (basis === 'paid' && !target.payment_available) throw invalid(`${source.renter_name}: 연결된 입금 내역이 없습니다.`);
    const amount = basis === 'paid' ? target.paid_amount : target.billed_amount;
    const exempt = source.exempt_amount;
    const taxable = amount - exempt;
    if (![amount, exempt, taxable].every(Number.isSafeInteger) || exempt < 0 || taxable <= 0) {
      throw invalid(`${source.renter_name}: 발행 총액은 수도료(면세)보다 커야 합니다.`);
    }
    const original = source.documents[0].items;
    if (original.some((item) => !Number.isSafeInteger(item.supply_amount) || item.supply_amount < 0)) {
      throw invalid('공급가액은 0 이상의 정수여야 합니다.');
    }
    const weight = original.reduce((sum, item) => sum + item.supply_amount, 0);
    if (weight <= 0) throw invalid('과세 공급가액을 확인해 주세요.');
    // Allocate the chosen VAT-inclusive total proportionally, with deterministic won remainders.
    let cumulative = 0;
    let allocated = 0;
    const items = original.map((item) => {
      cumulative += item.supply_amount;
      const next = Math.round(taxable * cumulative / weight);
      const gross = next - allocated;
      allocated = next;
      const supply = Math.round(gross / 1.1);
      return { ...item, supply_amount: supply, vat_amount: gross - supply };
    });
    const supply = items.reduce((sum, item) => sum + item.supply_amount, 0);
    const vat = items.reduce((sum, item) => sum + item.vat_amount, 0);
    Object.assign(target.documents[0], { items, supply_amount: supply, vat_amount: vat, total_amount: taxable });
    Object.assign(target, {
      rent_supply: items[0].supply_amount, rent_vat: items[0].vat_amount,
      management_supply: items[1].supply_amount, management_vat: items[1].vat_amount,
      other_supply: items[2]?.supply_amount || 0, other_vat: items[2]?.vat_amount || 0,
      supply_amount: supply, vat_amount: vat, total_amount: taxable,
    });
  }
  target.issue_amount = target.total_amount + target.exempt_amount;
  target.amount_revision = crypto.createHash('sha256').update(JSON.stringify({
    source, basis, payment: payment ? { id: String(payment.transaction_id), amount: String(payment.deposit_amount) } : null,
    documents: target.documents,
  })).digest('hex');
  return target;
}

export function assertAmountRevision(target, revision) {
  if (revision !== target.amount_revision) {
    throw Object.assign(new Error(`${target.renter_name}: 청구 또는 입금 정보가 변경되었습니다. 새로고침 후 금액을 다시 확인해 주세요.`), { status: 409 });
  }
}
