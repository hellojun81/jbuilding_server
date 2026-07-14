import crypto from 'crypto';
import popbill from 'popbill';

const REQUIRED_ENV = [
  'POPBILL_LINK_ID',
  'POPBILL_SECRET_KEY',
  'POPBILL_CORP_NUM',
  'POPBILL_USER_ID',
];

let configuredSignature = '';
let taxinvoiceService;

function providerName() {
  return String(process.env.TAX_INVOICE_PROVIDER || '').trim().toLowerCase();
}

function missingConfiguration() {
  const missing = REQUIRED_ENV.filter((key) => !String(process.env[key] || '').trim());
  if (providerName() !== 'popbill') missing.unshift('TAX_INVOICE_PROVIDER=popbill');
  return missing;
}

function configuration() {
  return {
    LinkID: process.env.POPBILL_LINK_ID,
    SecretKey: process.env.POPBILL_SECRET_KEY,
    IsTest: process.env.TAX_INVOICE_TEST_MODE !== 'false',
    IPRestrictOnOff: true,
    UseStaticIP: false,
    UseLocalTimeYN: true,
    defaultErrorHandler: () => {},
  };
}

function service() {
  const missing = missingConfiguration();
  if (missing.length > 0) {
    const error = new Error(`팝빌 설정값이 없습니다: ${missing.join(', ')}`);
    error.status = 503;
    throw error;
  }

  const nextConfiguration = configuration();
  const signature = JSON.stringify(nextConfiguration);
  if (!taxinvoiceService || configuredSignature !== signature) {
    popbill.config(nextConfiguration);
    taxinvoiceService = popbill.TaxinvoiceService();
    configuredSignature = signature;
  }
  return taxinvoiceService;
}

function popbillCall(invoke) {
  return new Promise((resolve, reject) => invoke(resolve, reject));
}

function popbillError(error, fallback) {
  const message = error?.message || fallback;
  const wrapped = new Error(error?.code ? `[팝빌 ${error.code}] ${message}` : message);
  wrapped.status = 502;
  wrapped.cause = error;
  return wrapped;
}

function monthEndDate(year, month) {
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return `${year}${month}${String(lastDay).padStart(2, '0')}`;
}

function koreaToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}${value.month}${value.day}`;
}

function writeDateForMonth(year, month) {
  const today = koreaToday();
  const billingMonth = `${year}${month}`;
  if (billingMonth > today.slice(0, 6)) {
    const error = new Error('미래 청구월의 전자세금계산서는 발행할 수 없습니다.');
    error.status = 400;
    throw error;
  }
  return billingMonth === today.slice(0, 6) ? today : monthEndDate(year, month);
}

function integerText(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    const error = new Error(`${fieldName} 금액이 올바른 정수가 아닙니다.`);
    error.status = 400;
    throw error;
  }
  return String(number);
}

function validEmail(value) {
  const email = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

export function makeDocumentKey({ year, month, renterCode, documentType }) {
  const renterHash = crypto.createHash('sha256').update(String(renterCode)).digest('hex').slice(0, 10);
  const typeCode = documentType === 'invoice' ? 'E' : 'T';
  return `R${year}${month}-${renterHash}-${typeCode}`;
}

export function buildTaxinvoice({ target, document, supplier, documentKey }) {
  const writeDate = writeDateForMonth(String(target.year), String(target.month).padStart(2, '0'));
  const purpose = ['영수', '청구', '없음'].includes(process.env.TAX_INVOICE_PURPOSE)
    ? process.env.TAX_INVOICE_PURPOSE
    : '청구';
  const supplyCostTotal = integerText(document.supply_amount, '공급가액');
  const taxTotal = integerText(document.vat_amount, '세액');
  const totalAmount = integerText(document.total_amount, '합계');

  const invoiceeNumber = String(target.business_number || '').replace(/\D/g, '');
  if (![10, 13].includes(invoiceeNumber.length)) {
    const error = new Error(`${target.renter_name}의 사업자 또는 주민등록번호가 올바르지 않습니다.`);
    error.status = 400;
    throw error;
  }
  if (!String(target.renter_name || '').trim() || !String(target.representative || '').trim()) {
    const error = new Error(`${target.renter_name || target.renter_code}의 상호 또는 대표자명이 없습니다.`);
    error.status = 400;
    throw error;
  }
  if (Number(document.total_amount) <= 0) {
    const error = new Error(`${target.renter_name}의 발행 합계는 0원보다 커야 합니다.`);
    error.status = 400;
    throw error;
  }

  return {
    writeDate,
    chargeDirection: '정과금',
    issueType: '정발행',
    purposeType: purpose,
    taxType: document.tax_type,
    invoicerCorpNum: String(process.env.POPBILL_CORP_NUM).replace(/\D/g, ''),
    invoicerMgtKey: documentKey,
    invoicerCorpName: supplier.corpName,
    invoicerCEOName: supplier.ceoname,
    invoicerAddr: supplier.addr,
    invoicerBizType: supplier.bizType,
    invoicerBizClass: supplier.bizClass,
    invoicerSMSSendYN: false,
    invoiceeType: invoiceeNumber.length === 13 ? '개인' : '사업자',
    invoiceeCorpNum: invoiceeNumber,
    invoiceeCorpName: String(target.renter_name).trim(),
    invoiceeCEOName: String(target.representative).trim(),
    invoiceeAddr: String(target.address || '').trim(),
    invoiceeContactName1: String(target.representative).trim(),
    invoiceeEmail1: validEmail(target.email),
    invoiceeSMSSendYN: false,
    supplyCostTotal,
    taxTotal,
    totalAmount,
    cash: '',
    chkBill: '',
    note: '',
    credit: totalAmount,
    remark1: `${target.year}년 ${Number(target.month)}월 임대관리 청구분`,
    detailList: document.items.map((item, index) => ({
      serialNum: index + 1,
      purchaseDT: writeDate,
      itemName: item.name,
      qty: '1',
      unitCost: integerText(item.supply_amount, `${item.name} 단가`),
      supplyCost: integerText(item.supply_amount, `${item.name} 공급가액`),
      tax: integerText(item.vat_amount, `${item.name} 세액`),
      remark: '',
    })),
  };
}

export function taxInvoiceProviderStatus() {
  const missing = missingConfiguration();
  return {
    provider: providerName(),
    configured: missing.length === 0,
    testMode: process.env.TAX_INVOICE_TEST_MODE !== 'false',
    documentTypes: ['tax_invoice', 'invoice'],
    missing,
  };
}

export async function verifyTaxInvoiceProvider() {
  const sdk = service();
  const corpNum = String(process.env.POPBILL_CORP_NUM).replace(/\D/g, '');
  const userID = process.env.POPBILL_USER_ID;
  try {
    const [corpInfo, certificate] = await Promise.all([
      popbillCall((success, error) => sdk.getCorpInfo(corpNum, userID, success, error)),
      popbillCall((success, error) => sdk.checkCertValidation(corpNum, userID, success, error)),
    ]);
    return { corpInfo, certificate };
  } catch (error) {
    throw popbillError(error, '팝빌 연동정보 확인에 실패했습니다.');
  }
}

export async function listIssuedTaxInvoices({ year, month }) {
  const sdk = service();
  const corpNum = String(process.env.POPBILL_CORP_NUM).replace(/\D/g, '');
  const userID = process.env.POPBILL_USER_ID;
  const paddedMonth = String(month).padStart(2, '0');
  const startDate = `${year}${paddedMonth}01`;
  const endDate = monthEndDate(String(year), paddedMonth);
  try {
    const result = await popbillCall((success, error) => sdk.search(
      corpNum, 'SELL', 'W', startDate, endDate,
      ['3**'], ['N'], ['T', 'N'], null, 'A', 1, 1000,
      userID, success, error,
    ));
    if (Number(result.total || 0) > 1000) {
      throw new Error('월 발행내역이 1,000건을 초과하여 안전하게 동기화할 수 없습니다.');
    }
    return Array.isArray(result.list) ? result.list : [];
  } catch (error) {
    throw popbillError(error, '팝빌 발행이력 조회에 실패했습니다.');
  }
}

export async function issueTaxInvoices({ issueTargets }) {
  const sdk = service();
  const corpNum = String(process.env.POPBILL_CORP_NUM).replace(/\D/g, '');
  const userID = process.env.POPBILL_USER_ID;
  let supplier;
  try {
    supplier = await popbillCall((success, error) => sdk.getCorpInfo(corpNum, userID, success, error));
  } catch (error) {
    throw popbillError(error, '팝빌 공급자 회사정보 확인에 실패했습니다.');
  }

  const results = [];
  for (const entry of issueTargets) {
    try {
      const taxinvoice = buildTaxinvoice({ ...entry, supplier });
      const response = await popbillCall((success, error) => sdk.registIssue(
        corpNum, taxinvoice, false, false, 'RentMng 일괄 발행', '', '', userID, success, error,
      ));
      results.push({ ...entry, success: true, response });
    } catch (error) {
      results.push({ ...entry, success: false, error: popbillError(error, '팝빌 발행에 실패했습니다.') });
    }
  }
  return results;
}
