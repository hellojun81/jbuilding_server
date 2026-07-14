import popbill from 'popbill';

const REQUIRED_ENV = [
  'POPBILL_LINK_ID',
  'POPBILL_SECRET_KEY',
  'POPBILL_CORP_NUM',
  'POPBILL_USER_ID',
];

let configuredSignature = '';
let htTaxinvoiceService;
let htCashbillService;

function missingConfiguration() {
  const missing = REQUIRED_ENV.filter((key) => !String(process.env[key] || '').trim());
  if (String(process.env.TAX_INVOICE_PROVIDER || '').trim().toLowerCase() !== 'popbill') {
    missing.unshift('TAX_INVOICE_PROVIDER=popbill');
  }
  return missing;
}

function services() {
  const missing = missingConfiguration();
  if (missing.length > 0) {
    const error = new Error(`팝빌 설정값이 없습니다: ${missing.join(', ')}`);
    error.status = 503;
    throw error;
  }

  const configuration = {
    LinkID: process.env.POPBILL_LINK_ID,
    SecretKey: process.env.POPBILL_SECRET_KEY,
    IsTest: process.env.TAX_INVOICE_TEST_MODE !== 'false',
    IPRestrictOnOff: true,
    UseStaticIP: false,
    UseLocalTimeYN: true,
    defaultErrorHandler: () => {},
  };
  const signature = JSON.stringify(configuration);
  if (!htTaxinvoiceService || !htCashbillService || configuredSignature !== signature) {
    popbill.config(configuration);
    htTaxinvoiceService = popbill.HTTaxinvoiceService();
    htCashbillService = popbill.HTCashbillService();
    configuredSignature = signature;
  }
  return { htTaxinvoiceService, htCashbillService };
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

function compactDate(value) {
  return String(value || '').replace(/\D/g, '');
}

function parseDate(value, fieldName) {
  const compact = compactDate(value);
  if (!/^\d{8}$/.test(compact)) {
    throw Object.assign(new Error(`${fieldName}이 올바르지 않습니다.`), { status: 400 });
  }
  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6));
  const day = Number(compact.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw Object.assign(new Error(`${fieldName}이 올바르지 않습니다.`), { status: 400 });
  }
  return { compact, date };
}

export function validateCollectionPeriod(startDate, endDate) {
  const start = parseDate(startDate, '조회 시작일');
  const end = parseDate(endDate, '조회 종료일');
  if (start.date > end.date) {
    throw Object.assign(new Error('조회 시작일은 종료일보다 늦을 수 없습니다.'), { status: 400 });
  }
  const limit = new Date(start.date);
  limit.setUTCMonth(limit.getUTCMonth() + 3);
  if (end.date >= limit) {
    throw Object.assign(new Error('팝빌 홈택스 자료는 한 번에 최대 3개월까지 조회할 수 있습니다.'), { status: 400 });
  }
  return { startDate: start.compact, endDate: end.compact };
}

export function vatProviderStatus() {
  const missing = missingConfiguration();
  return {
    provider: 'popbill',
    configured: missing.length === 0,
    testMode: process.env.TAX_INVOICE_TEST_MODE !== 'false',
    missing,
    sources: {
      taxInvoice: { supported: true, label: '팝빌 홈택스수집(세금)' },
      cashReceipt: { supported: true, label: '팝빌 홈택스수집(현금)' },
      businessCard: { supported: false, label: '별도 카드사 또는 홈택스 연동 필요' },
    },
  };
}

async function serviceReadiness(sdk, corpNum, userID) {
  try {
    const [flatRate, certificate] = await Promise.all([
      popbillCall((success, error) => sdk.getFlatRateState(corpNum, userID, success, error)),
      popbillCall((success, error) => sdk.checkCertValidation(corpNum, success, error)),
    ]);
    const active = Number(flatRate?.state) === 1 && flatRate?.useRestrictYN !== true;
    return {
      connected: true,
      ready: active && Number(certificate?.code) === 1,
      subscriptionActive: active,
      certificateValid: Number(certificate?.code) === 1,
      certificateMessage: certificate?.message || '',
      useEndDate: flatRate?.useEndDate || '',
    };
  } catch (error) {
    return {
      connected: false,
      ready: false,
      message: error?.message || '팝빌 홈택스수집 서비스 상태 확인에 실패했습니다.',
    };
  }
}

export async function verifyVatProvider() {
  const { htTaxinvoiceService: taxSdk, htCashbillService: cashSdk } = services();
  const corpNum = compactDate(process.env.POPBILL_CORP_NUM);
  const userID = process.env.POPBILL_USER_ID;
  const [taxInvoice, cashReceipt] = await Promise.all([
    serviceReadiness(taxSdk, corpNum, userID),
    serviceReadiness(cashSdk, corpNum, userID),
  ]);
  return {
    ready: taxInvoice.ready && cashReceipt.ready,
    taxInvoice,
    cashReceipt,
    businessCard: { connected: false, ready: false, message: '팝빌 미지원 · 별도 연동 필요' },
  };
}

export async function requestVatCollection({ startDate, endDate }) {
  const period = validateCollectionPeriod(startDate, endDate);
  const readiness = await verifyVatProvider();
  if (!readiness.ready) {
    const reasons = [readiness.taxInvoice, readiness.cashReceipt]
      .filter((state) => !state.ready)
      .map((state) => state.message || '정액제 또는 공동인증서 상태를 확인해 주세요.');
    throw Object.assign(
      new Error(`팝빌 홈택스수집 서비스가 준비되지 않았습니다: ${[...new Set(reasons)].join(' / ')}`),
      { status: 409 },
    );
  }
  const { htTaxinvoiceService: taxSdk, htCashbillService: cashSdk } = services();
  const corpNum = compactDate(process.env.POPBILL_CORP_NUM);
  const userID = process.env.POPBILL_USER_ID;
  try {
    const [taxJobID, cashSellJobID, cashBuyJobID] = await Promise.all([
      popbillCall((success, error) => taxSdk.requestJob(
        corpNum, 'SELL', 'W', period.startDate, period.endDate, userID, success, error,
      )),
      popbillCall((success, error) => cashSdk.requestJob(
        corpNum, 'SELL', period.startDate, period.endDate, userID, success, error,
      )),
      popbillCall((success, error) => cashSdk.requestJob(
        corpNum, 'BUY', period.startDate, period.endDate, userID, success, error,
      )),
    ]);
    return {
      period,
      jobs: [
        { source: 'tax_invoice', direction: 'SELL', jobID: taxJobID },
        { source: 'cash_receipt', direction: 'SELL', jobID: cashSellJobID },
        { source: 'cash_receipt', direction: 'BUY', jobID: cashBuyJobID },
      ],
    };
  } catch (error) {
    throw popbillError(error, '홈택스 자료 수집 요청에 실패했습니다.');
  }
}

function assertJobs(jobs) {
  if (!Array.isArray(jobs) || jobs.length !== 3) {
    throw Object.assign(new Error('수집 작업정보가 올바르지 않습니다.'), { status: 400 });
  }
  return jobs.map((job) => {
    if (!['tax_invoice', 'cash_receipt'].includes(job?.source)
      || !['SELL', 'BUY'].includes(job?.direction)
      || !/^[A-Za-z0-9]{18}$/.test(String(job?.jobID || ''))) {
      throw Object.assign(new Error('수집 작업정보가 올바르지 않습니다.'), { status: 400 });
    }
    return { source: job.source, direction: job.direction, jobID: String(job.jobID) };
  });
}

async function searchAll(searchPage) {
  const first = await searchPage(1);
  const results = Array.isArray(first?.list) ? [...first.list] : [];
  const pageCount = Math.min(Number(first?.pageCount || 1), 100);
  for (let page = 2; page <= pageCount; page += 1) {
    const response = await searchPage(page);
    if (Array.isArray(response?.list)) results.push(...response.list);
  }
  return results;
}

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function signedCashAmount(value, tradeType) {
  const amount = numberValue(value);
  const cancelled = String(tradeType || '').includes('취소') || String(tradeType) === 'C';
  return cancelled && amount > 0 ? -amount : amount;
}

export function normalizeTaxInvoice(record) {
  return {
    id: record.ntsconfirmNum || '',
    source: 'tax_invoice',
    sourceLabel: '매출 세금계산서',
    direction: 'SELL',
    date: record.writeDate || '',
    partyName: record.invoiceeCorpName || record.invoiceeCEOName || '',
    partyNumber: record.invoiceeCorpNum || '',
    supplyAmount: numberValue(record.supplyCostTotal),
    vatAmount: numberValue(record.taxTotal),
    totalAmount: numberValue(record.totalAmount),
    status: record.taxType || '수집완료',
  };
}

export function normalizeCashReceipt(record, direction) {
  return {
    id: record.ntsconfirmNum || '',
    source: 'cash_receipt',
    sourceLabel: direction === 'BUY' ? '매입 현금영수증' : '매출 현금영수증',
    direction,
    date: record.tradeDate || String(record.tradeDT || '').slice(0, 8),
    partyName: direction === 'BUY'
      ? (record.franchiseCorpName || record.cardOwnerName || '')
      : (record.customerName || `식별번호 끝 ${record.identityNum || ''}`),
    partyNumber: direction === 'BUY' ? (record.franchiseCorpNum || '') : '',
    supplyAmount: signedCashAmount(record.supplyCost, record.tradeType),
    vatAmount: signedCashAmount(record.tax, record.tradeType),
    totalAmount: signedCashAmount(record.totalAmount, record.tradeType),
    status: record.tradeType || '수집완료',
  };
}

async function fetchJobRecords(job, taxSdk, cashSdk, corpNum, userID) {
  if (job.source === 'tax_invoice') {
    const records = await searchAll((page) => popbillCall((success, error) => taxSdk.search(
      corpNum, job.jobID, ['N', 'M'], [], [], '', '', '', page, 1000, 'A', userID, '', success, error,
    )));
    return records.map(normalizeTaxInvoice);
  }
  const records = await searchAll((page) => popbillCall((success, error) => cashSdk.search(
    corpNum, job.jobID, [], [], page, 1000, 'A', userID, success, error,
  )));
  return records.map((record) => normalizeCashReceipt(record, job.direction));
}

export async function getVatCollection(jobs) {
  const safeJobs = assertJobs(jobs);
  const { htTaxinvoiceService: taxSdk, htCashbillService: cashSdk } = services();
  const corpNum = compactDate(process.env.POPBILL_CORP_NUM);
  const userID = process.env.POPBILL_USER_ID;
  try {
    const states = await Promise.all(safeJobs.map(async (job) => {
      const sdk = job.source === 'tax_invoice' ? taxSdk : cashSdk;
      const state = await popbillCall((success, error) => sdk.getJobState(
        corpNum, job.jobID, userID, success, error,
      ));
      return { ...job, ...state };
    }));
    const failed = states.filter((state) => Number(state.jobState) === 3 && Number(state.errorCode) !== 1);
    if (failed.length > 0) {
      return {
        status: 'failed',
        states,
        records: [],
        message: failed.map((state) => state.errorReason || '수집에 실패했습니다.').join(' / '),
      };
    }
    if (!states.every((state) => Number(state.jobState) === 3 && Number(state.errorCode) === 1)) {
      return { status: 'collecting', states, records: [] };
    }
    const recordGroups = await Promise.all(safeJobs.map((job) => (
      fetchJobRecords(job, taxSdk, cashSdk, corpNum, userID)
    )));
    return { status: 'complete', states, records: recordGroups.flat() };
  } catch (error) {
    throw popbillError(error, '홈택스 수집 상태 확인에 실패했습니다.');
  }
}
