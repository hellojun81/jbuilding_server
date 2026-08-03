import crypto from 'crypto';
import popbill from 'popbill';

const REQUIRED_ENV = ['POPBILL_LINK_ID', 'POPBILL_SECRET_KEY', 'POPBILL_CORP_NUM', 'POPBILL_USER_ID'];
let configuredSignature = '';
let easyFinBankService;

function configuration() {
  return {
    LinkID: process.env.POPBILL_LINK_ID,
    SecretKey: process.env.POPBILL_SECRET_KEY,
    IsTest: process.env.BANK_ACCOUNT_TEST_MODE
      ? process.env.BANK_ACCOUNT_TEST_MODE !== 'false'
      : process.env.TAX_INVOICE_TEST_MODE !== 'false',
    IPRestrictOnOff: true,
    UseStaticIP: false,
    UseLocalTimeYN: true,
    defaultErrorHandler: () => {},
  };
}

function missingConfiguration() {
  return REQUIRED_ENV.filter((key) => !String(process.env[key] || '').trim());
}

function service() {
  const missing = missingConfiguration();
  if (missing.length > 0) throw Object.assign(new Error(`팝빌 설정값이 없습니다: ${missing.join(', ')}`), { status: 503 });
  const next = configuration();
  const signature = JSON.stringify(next);
  if (!easyFinBankService || configuredSignature !== signature) {
    popbill.config(next);
    easyFinBankService = popbill.EasyFinBankService();
    configuredSignature = signature;
  }
  return easyFinBankService;
}

function callPopbill(invoke) {
  return new Promise((resolve, reject) => invoke(resolve, reject));
}

function wrapError(error, fallback) {
  const wrapped = new Error(error?.code ? `[팝빌 ${error.code}] ${error.message || fallback}` : (error?.message || fallback));
  wrapped.status = 502;
  wrapped.cause = error;
  return wrapped;
}

function accountKey(account) {
  return crypto.createHash('sha256')
    .update(`${account.bankCode}|${account.accountNumber}`)
    .digest('hex');
}

function maskAccountNumber(value) {
  const number = String(value || '');
  return number ? `${'*'.repeat(Math.max(0, number.length - 4))}${number.slice(-4)}` : '';
}

async function rawAccounts() {
  const sdk = service();
  const corpNum = String(process.env.POPBILL_CORP_NUM).replace(/\D/g, '');
  const userID = process.env.POPBILL_USER_ID;
  try {
    const rows = await callPopbill((success, error) => sdk.listBankAccount(corpNum, userID, success, error));
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    throw wrapError(error, '팝빌 등록계좌 조회에 실패했습니다.');
  }
}

export function bankProviderStatus() {
  const missing = missingConfiguration();
  return { provider: 'popbill', configured: missing.length === 0, testMode: configuration().IsTest, missing };
}

export function bankCollectionSucceeded(state) {
  return Number(state?.jobState) === 3
    && Number(state?.errorCode) === 1
    && String(state?.errorReason || '').trim() === '수집 완료';
}

export async function listBankAccounts() {
  const accounts = await rawAccounts();
  return accounts.map((account) => ({
    accountKey: accountKey(account),
    bankCode: String(account.bankCode || ''),
    accountName: String(account.accountName || ''),
    accountType: String(account.accountType || ''),
    accountNumberMasked: maskAccountNumber(account.accountNumber),
    state: Number(account.state || 0),
    contractState: Number(account.contractState || 0),
    useRestrictYN: String(account.useRestrictYN || 'N'),
    unPaidYN: String(account.unPaidYN || 'N'),
  }));
}

async function resolveAccount(key) {
  const accounts = await rawAccounts();
  const account = accounts.find((candidate) => accountKey(candidate) === String(key || ''));
  if (!account) throw Object.assign(new Error('선택한 팝빌 등록계좌를 찾을 수 없습니다.'), { status: 404 });
  if (Number(account.state) !== 1 || String(account.useRestrictYN || 'N') === 'Y') {
    throw Object.assign(new Error('선택한 계좌는 현재 거래내역을 조회할 수 없는 상태입니다.'), { status: 409 });
  }
  return account;
}

export async function requestBankCollection({ accountKey: key, startDate, endDate }) {
  const account = await resolveAccount(key);
  const sdk = service();
  const corpNum = String(process.env.POPBILL_CORP_NUM).replace(/\D/g, '');
  const userID = process.env.POPBILL_USER_ID;
  try {
    const jobId = await callPopbill((success, error) => sdk.requestJob(
      corpNum, account.bankCode, account.accountNumber, startDate, endDate, userID, success, error,
    ));
    return {
      jobId,
      bankCode: String(account.bankCode),
      accountNumberMasked: maskAccountNumber(account.accountNumber),
    };
  } catch (error) {
    throw wrapError(error, '팝빌 은행 거래내역 수집 요청에 실패했습니다.');
  }
}

export async function getBankCollection(jobId) {
  const sdk = service();
  const corpNum = String(process.env.POPBILL_CORP_NUM).replace(/\D/g, '');
  const userID = process.env.POPBILL_USER_ID;
  try {
    const state = await callPopbill((success, error) => sdk.getJobState(corpNum, jobId, userID, success, error));
    const jobState = Number(state?.jobState || 0);
    if (jobState !== 3) return { state, transactions: [] };
    if (!bankCollectionSucceeded(state)) return { state, transactions: [], failed: true };
    const result = await callPopbill((success, error) => sdk.search(
      corpNum, jobId, ['I'], '', 1, 1000, 'D', userID, success, error,
    ));
    if (Number(result?.total || 0) > 1000) {
      throw Object.assign(new Error('조회 결과가 1,000건을 초과하여 안전하게 가져올 수 없습니다.'), { status: 409 });
    }
    return { state, transactions: Array.isArray(result?.list) ? result.list : [] };
  } catch (error) {
    if (error?.status) throw error;
    throw wrapError(error, '팝빌 은행 거래내역 결과 조회에 실패했습니다.');
  }
}
