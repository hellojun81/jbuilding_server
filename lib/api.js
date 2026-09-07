import crypto from 'crypto';
import express from 'express';
import sql from './CRUD.js';
import {
  issueTaxInvoices,
  listIssuedTaxInvoices,
  makeDocumentKey,
  taxInvoiceProviderStatus,
  verifyTaxInvoiceProvider,
} from './taxInvoiceProvider.js';
import {
  getVatCollection,
  requestVatCollection,
  vatProviderStatus,
  verifyVatProvider,
} from './vatDataProvider.js';
import {
  bankProviderStatus,
  getBankCollection,
  listBankAccounts,
  requestBankCollection,
} from './bankTransactionProvider.js';
import { billTotal, matchCandidates, normalizeMatchText } from './bankMatching.js';
import { normalizeQueryRows } from './queryRows.js';
import { buildSessionCookie } from './sessionCookie.js';

const router = express.Router();
const sessions = new Map();
const sessionTtlMs = Number(process.env.SESSION_TTL_HOURS || 8) * 60 * 60 * 1000;

const renterFields = [
  'building_name', 'address', 'name', 'name2', 'licensenum', 'tel', 'email', 'etc',
  'start_date', 'end_date', 'deposit', 'rent_bill', 'mng_bill', 'vat_bill',
  'water_bill', 'other_bill', 'other_vat_bill', 'contract_date',
];
const renterWriteFields = new Set(renterFields);
const billWriteFields = new Set([
  'rent_bill', 'mng_bill', 'vat_bill', 'water_bill', 'other_bill', 'other_vat_bill', 'etc', 'date',
]);

function safeEqual(left = '', right = '') {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function cookieValue(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  const cookie = cookies.find((value) => value.trim().startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.trim().slice(name.length + 1)) : '';
}

function sessionCookie(token, maxAge = sessionTtlMs) {
  return buildSessionCookie(token, maxAge);
}

function normalized(rows) {
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, value == null ? '' : String(value)]),
  ));
}

function selectAllowed(source, allowedFields) {
  return Object.fromEntries(
    Object.entries(source || {}).filter(([key]) => allowedFields.has(key)),
  );
}

function synchronizeLegacyWater(data, legacyField) {
  return Object.prototype.hasOwnProperty.call(data, 'water_bill')
    ? { ...data, [legacyField]: data.water_bill }
    : data;
}

function taxDocumentData(row, year, month) {
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

function registrationNumberDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function maskedRegistrationNumber(value) {
  const digits = registrationNumberDigits(value);
  if (digits.length === 13) return `${digits.slice(0, 6)}-${digits.slice(6, 7)}******`;
  return digits;
}

function remoteDocumentMatches(target, document, remoteDocument) {
  return String(remoteDocument.invoiceeCorpNum || '') === String(target.business_number || '')
    && String(remoteDocument.taxType || '') === String(document.tax_type || '')
    && Number(remoteDocument.supplyCostTotal) === Number(document.supply_amount)
    && Number(remoteDocument.taxTotal) === Number(document.vat_amount)
    && Number(remoteDocument.stateCode) >= 300
    && Number(remoteDocument.stateCode) <= 305;
}

function documentIssueStatus(target, document, localRows, remoteDocuments) {
  if (remoteDocuments.some((remote) => remoteDocumentMatches(target, document, remote))) {
    return 'issued';
  }
  return localRows.find((row) => (
    String(row.comp_code) === String(target.renter_code)
    && row.document_type === document.document_type
  ))?.issue_status || 'unissued';
}

function targetIssueStatus(target, localRows, remoteDocuments) {
  const statuses = target.documents.map((document) => (
    documentIssueStatus(target, document, localRows, remoteDocuments)
  ));
  if (statuses.every((status) => status === 'issued')) return '발행완료';
  if (statuses.some((status) => status === 'issued')) return '부분발행';
  if (statuses.some((status) => status === 'queued')) return '처리중';
  if (statuses.some((status) => status === 'failed')) return '발행실패';
  return '미발행';
}

function taxTargetValidationErrors(row) {
  const errors = [];
  if (![10, 13].includes(registrationNumberDigits(row.business_number).length)) {
    errors.push('사업자/주민등록번호 확인 필요');
  }
  if (!String(row.renter_name || '').trim()) errors.push('상호 확인 필요');
  if (!String(row.representative || '').trim()) errors.push('대표자명 확인 필요');
  if (!row.base_vat_matches) errors.push('임대료·관리비 VAT 합계 불일치');
  if (row.other_vat !== Math.round(row.other_supply * 0.1)) errors.push('기타요금 VAT 불일치');
  if (row.documents.some((document) => Number(document.total_amount) <= 0)) errors.push('발행금액 확인 필요');
  return errors;
}

async function taxInvoiceHistory(year, month) {
  const [rows] = await sql.query(
    `SELECT comp_code, document_type, provider_document_key, issue_status,
            nts_confirm_number, error_message
       FROM tax_invoice_issues
      WHERE bill_year = ? AND bill_month = ?`,
    [year, month],
  );
  return rows;
}

async function reserveTaxInvoiceIssues(year, month, entries) {
  if (entries.length === 0) return;
  const renterCodes = [...new Set(entries.map((entry) => String(entry.target.renter_code)))];
  const placeholders = renterCodes.map(() => '?').join(', ');
  await sql.query(
    `DELETE FROM tax_invoice_issues
      WHERE bill_year = ? AND bill_month = ? AND issue_status = 'failed'
        AND comp_code IN (${placeholders})`,
    [year, month, ...renterCodes],
  );
  const values = entries.flatMap(({ target, document, documentKey }) => [
    target.renter_code,
    year,
    month,
    document.document_type,
    'popbill',
    documentKey,
    document.supply_amount,
    document.vat_amount,
    JSON.stringify(document.items),
    'queued',
  ]);
  const valuePlaceholders = entries.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
  await sql.query(
    `INSERT INTO tax_invoice_issues
       (comp_code, bill_year, bill_month, document_type, provider,
        provider_document_key, supply_amount, vat_amount, items_json, issue_status)
     VALUES ${valuePlaceholders}`,
    values,
  );
}

async function updateTaxInvoiceIssue(result) {
  const message = result.error?.message ? String(result.error.message).slice(0, 500) : null;
  await sql.query(
    `UPDATE tax_invoice_issues
        SET issue_status = ?, nts_confirm_number = ?, error_message = ?, issued_at = ?
      WHERE provider = 'popbill' AND provider_document_key = ?`,
    [
      result.success ? 'issued' : 'failed',
      result.response?.ntsConfirmNum || null,
      message,
      result.success ? new Date() : null,
      result.documentKey,
    ],
  );
}

function assertDate(date) {
  if (!/^\d{4}\.\d{2}(?:\.\d{2})?$/.test(String(date || ''))) {
    const error = new Error('날짜 형식이 올바르지 않습니다.');
    error.status = 400;
    throw error;
  }
  const [year, month] = String(date).split('.');
  if (Number(month) < 1 || Number(month) > 12) {
    const error = new Error('월 값이 올바르지 않습니다.');
    error.status = 400;
    throw error;
  }
  return { year, month };
}

function assertCompactDate(value, fieldName) {
  const date = String(value || '').replace(/-/g, '');
  if (!/^\d{8}$/.test(date)) throw Object.assign(new Error(`${fieldName} 형식이 올바르지 않습니다.`), { status: 400 });
  const parsed = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8))));
  if (parsed.toISOString().slice(0, 10).replace(/-/g, '') !== date) {
    throw Object.assign(new Error(`${fieldName}가 올바른 날짜가 아닙니다.`), { status: 400 });
  }
  return date;
}

function sqlDate(compact) {
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function sqlDateTime(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  return `${sqlDate(digits.slice(0, 8))}${digits.length >= 14
    ? ` ${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}` : ' 00:00:00'}`;
}

function payerKey(transaction) {
  const payer = normalizeMatchText(transaction?.remark1);
  return payer.length >= 2 ? crypto.createHash('sha256').update(payer).digest('hex') : '';
}

function previousBillingPeriod(year, month) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 2, 1));
  return {
    year: String(date.getUTCFullYear()),
    month: String(date.getUTCMonth() + 1).padStart(2, '0'),
  };
}

function assertCollectionRange(startValue, endValue) {
  const startDate = assertCompactDate(startValue, '조회 시작일');
  const endDate = assertCompactDate(endValue, '조회 종료일');
  const start = new Date(`${sqlDate(startDate)}T00:00:00Z`);
  const end = new Date(`${sqlDate(endDate)}T00:00:00Z`);
  const days = Math.round((end - start) / 86400000) + 1;
  if (days < 1 || days > 31) {
    throw Object.assign(new Error('은행 거래내역은 한 번에 31일 이내로 조회해 주세요.'), { status: 400 });
  }
  const koreaToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).replace(/-/g, '');
  if (endDate > koreaToday) {
    throw Object.assign(new Error('조회 종료일은 오늘 이후일 수 없습니다.'), { status: 400 });
  }
  return { startDate, endDate };
}

function assertRenter(renter) {
  if (!renter || String(renter).length > 100) {
    const error = new Error('임차인 값이 올바르지 않습니다.');
    error.status = 400;
    throw error;
  }
  return String(renter);
}

async function updateRecord(table, data, whereSql, whereValues) {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    const error = new Error('수정할 값이 없습니다.');
    error.status = 400;
    throw error;
  }
  const assignments = entries.map(([key]) => `\`${key}\` = ?`).join(', ');
  const [result] = await sql.query(
    `UPDATE ${table} SET ${assignments} WHERE ${whereSql}`,
    [...entries.map(([, value]) => value), ...whereValues],
  );
  return result.affectedRows;
}

export function requireAuth(req, res, next) {
  const token = cookieValue(req, 'rent_session');
  const expiresAt = sessions.get(token);
  if (!token || !expiresAt || expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  sessions.set(token, Date.now() + sessionTtlMs);
  next();
}

router.post('/login', (req, res) => {
  const configuredId = process.env.ADMIN_ID;
  const configuredPassword = process.env.ADMIN_PASSWORD;
  if (!configuredId || !configuredPassword) {
    return res.status(503).json({ error: '서버 관리자 계정이 설정되지 않았습니다.' });
  }
  if (!safeEqual(req.body?.id, configuredId) || !safeEqual(req.body?.password, configuredPassword)) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 틀립니다.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + sessionTtlMs);
  res.setHeader('Set-Cookie', sessionCookie(token));
  res.json({ authenticated: true });
});

router.get('/session', requireAuth, (req, res) => res.json({ authenticated: true }));

router.post('/logout', requireAuth, (req, res) => {
  sessions.delete(cookieValue(req, 'rent_session'));
  res.setHeader('Set-Cookie', sessionCookie('', 0));
  res.json({ authenticated: false });
});

router.use(requireAuth);

router.get('/renters', async (req, res, next) => {
  try {
    const [rows] = await sql.query(
      req.query.all === 'true'
        ? 'SELECT name FROM jbuildingmng ORDER BY name'
        : 'SELECT name FROM jbuildingmng WHERE dealYN = ? ORDER BY name',
      req.query.all === 'true' ? [] : ['Y'],
    );
    res.json(normalized(rows));
  } catch (error) { next(error); }
});

router.get('/renters/:renter', async (req, res, next) => {
  try {
    const renter = assertRenter(req.params.renter);
    const [rows] = await sql.query(
      `SELECT ${renterFields.map((field) => `\`${field}\``).join(', ')}
         FROM jbuildingmng WHERE name = ? AND dealYN = ? LIMIT 1`,
      [renter, 'Y'],
    );
    res.json(normalized(rows));
  } catch (error) { next(error); }
});

router.post('/renters', async (req, res, next) => {
  try {
    const data = synchronizeLegacyWater(selectAllowed(req.body, renterWriteFields), 'ETC_BILL');
    if (!data.name) throw Object.assign(new Error('임차인 상호는 필수입니다.'), { status: 400 });
    const entries = Object.entries({ ...data, dealYN: 'Y' });
    const columns = entries.map(([key]) => `\`${key}\``).join(', ');
    const placeholders = entries.map(() => '?').join(', ');
    const [result] = await sql.query(
      `INSERT INTO jbuildingmng (${columns}) VALUES (${placeholders})`,
      entries.map(([, value]) => value),
    );
    res.status(201).json({ affectedRows: result.affectedRows });
  } catch (error) { next(error); }
});

router.patch('/renters/:renter', async (req, res, next) => {
  try {
    const renter = assertRenter(req.params.renter);
    const data = synchronizeLegacyWater(selectAllowed(req.body, renterWriteFields), 'ETC_BILL');
    const affectedRows = await updateRecord('jbuildingmng', data, 'name = ?', [renter]);
    res.json({ affectedRows });
  } catch (error) { next(error); }
});

router.get('/bills', async (req, res, next) => {
  try {
    const { year, month } = assertDate(`${req.query.year}.${req.query.month}`);
    const search = String(req.query.search || '');
    const [rows] = await sql.query(
      `SELECT b.name, a.finish
         FROM jbuildingrentbill a
         JOIN jbuildingmng b ON a.comp_code = b.key_code
        WHERE a.year = ? AND a.month = ? AND b.name LIKE ? AND b.dealYN = ?
        ORDER BY b.name`,
      [year, month, `%${search}%`, 'Y'],
    );
    res.json(normalized(rows));
  } catch (error) { next(error); }
});

router.get('/bills/:renter', async (req, res, next) => {
  try {
    const renter = assertRenter(req.params.renter);
    const { year, month } = assertDate(req.query.date);
    const date = String(req.query.date);
    const isPayment = req.query.mode === 'payment';
    const [existing] = await sql.query(
      `SELECT b.rent_bill, b.mng_bill, b.vat_bill, b.water_bill,
              b.other_bill, b.other_vat_bill, b.etc,
              ? AS date, b.finish
         FROM jbuildingmng a
         JOIN jbuildingrentbill b ON a.key_code = b.comp_code
        WHERE a.name = ? AND a.dealYN = ? AND b.year = ? AND b.month = ? LIMIT 1`,
      [date, renter, 'Y', year, month],
    );
    if (existing.length > 0) {
      const values = normalized(existing);
      return res.json(isPayment ? values : { exists: true, value: values });
    }
    if (isPayment) return res.json([]);
    const [defaults] = await sql.query(
      `SELECT rent_bill, mng_bill,
              ROUND((COALESCE(rent_bill, 0) + COALESCE(mng_bill, 0)) * 0.1) AS vat_bill,
              COALESCE(water_bill, 0) AS water_bill,
              COALESCE(other_bill, 0) AS other_bill,
              COALESCE(other_vat_bill, 0) AS other_vat_bill,
              '' AS etc, ? AS date, 'N' AS finish
         FROM jbuildingmng WHERE name = ? AND dealYN = ? LIMIT 1`,
      [date, renter, 'Y'],
    );
    res.json(normalized(defaults));
  } catch (error) { next(error); }
});

router.post('/bills/:renter', async (req, res, next) => {
  try {
    const renter = assertRenter(req.params.renter);
    const data = synchronizeLegacyWater(selectAllowed(req.body, billWriteFields), 'etc_bill');
    const { year, month } = assertDate(data.date);
    const compCode = await sql.getRenterCode(renter);
    const [duplicate] = await sql.query(
      'SELECT 1 FROM jbuildingrentbill WHERE comp_code = ? AND year = ? AND month = ? LIMIT 1',
      [compCode, year, month],
    );
    if (duplicate.length > 0) throw Object.assign(new Error('해당 월의 청구서가 이미 존재합니다.'), { status: 409 });
    const entries = Object.entries({ ...data, comp_code: compCode, year, month, finish: 'N' });
    const [result] = await sql.query(
      `INSERT INTO jbuildingrentbill (${entries.map(([key]) => `\`${key}\``).join(', ')})
       VALUES (${entries.map(() => '?').join(', ')})`,
      entries.map(([, value]) => value),
    );
    res.status(201).json({ affectedRows: result.affectedRows });
  } catch (error) { next(error); }
});

router.patch('/bills/:renter', async (req, res, next) => {
  try {
    const renter = assertRenter(req.params.renter);
    const data = synchronizeLegacyWater(selectAllowed(req.body, billWriteFields), 'etc_bill');
    const { year, month } = assertDate(data.date);
    const compCode = await sql.getRenterCode(renter);
    const affectedRows = await updateRecord(
      'jbuildingrentbill', data, 'comp_code = ? AND year = ? AND month = ?',
      [compCode, year, month],
    );
    res.json({ affectedRows });
  } catch (error) { next(error); }
});

router.patch('/bills/:renter/payment', async (req, res, next) => {
  try {
    const renter = assertRenter(req.params.renter);
    const { year, month } = assertDate(req.body?.date);
    if (!['Y', 'N'].includes(req.body?.finish)) throw Object.assign(new Error('수납 상태가 올바르지 않습니다.'), { status: 400 });
    const compCode = await sql.getRenterCode(renter);
    const affectedRows = await updateRecord(
      'jbuildingrentbill', { finish: req.body.finish },
      'comp_code = ? AND year = ? AND month = ?', [compCode, year, month],
    );
    res.json({ affectedRows });
  } catch (error) { next(error); }
});

router.get('/summary', async (req, res, next) => {
  try {
    const [year, month] = String(req.query.date || '').split('-');
    assertDate(`${year}.${month}`);
    const [rows] = await sql.query(
      `SELECT COALESCE(SUM(rent_bill + mng_bill + vat_bill + water_bill + other_bill + other_vat_bill), 0) AS tmoney,
              COALESCE(SUM(CASE WHEN finish = 'Y'
                           THEN rent_bill + mng_bill + vat_bill + water_bill + other_bill + other_vat_bill ELSE 0 END), 0) AS minab
         FROM jbuildingrentbill WHERE year = ? AND month = ?`,
      [year, month],
    );
    res.json(normalized(rows));
  } catch (error) { next(error); }
});

router.get('/tax-invoices', async (req, res, next) => {
  try {
    const { year, month } = assertDate(`${req.query.year}.${req.query.month}`);
    const [rows] = await sql.query(
      `SELECT a.key_code AS renter_code, a.name AS renter_name, a.name2 AS representative,
              REPLACE(REPLACE(a.licensenum, '-', ''), ' ', '') AS business_number,
              a.email, a.address,
              COALESCE(b.rent_bill, 0) AS rent_supply,
              COALESCE(b.mng_bill, 0) AS management_supply,
              COALESCE(b.vat_bill, 0) AS base_vat,
              COALESCE(b.other_bill, 0) AS other_supply,
              COALESCE(b.other_vat_bill, 0) AS other_vat,
              COALESCE(b.water_bill, 0) AS water_supply
         FROM jbuildingmng a
         JOIN jbuildingrentbill b ON a.key_code = b.comp_code
        WHERE b.year = ? AND b.month = ? AND a.dealYN = ?
        ORDER BY a.name`,
      [year, month, 'Y'],
    );
    const targets = rows.map((sourceRow) => taxDocumentData(sourceRow, year, month));
    let localHistory = [];
    let remoteDocuments = [];
    let historyConnected = false;
    const provider = taxInvoiceProviderStatus();
    if (provider.configured) {
      try {
        [localHistory, remoteDocuments] = await Promise.all([
          taxInvoiceHistory(year, month),
          listIssuedTaxInvoices({ year, month }),
        ]);
        historyConnected = true;
      } catch (error) {
        console.error('Tax invoice history sync failed:', error.message);
      }
    }
    const invoices = targets.map((row) => {
      const expectedVat = row.rent_vat + row.management_vat + Math.round(row.other_supply * 0.1);
      const errors = taxTargetValidationErrors(row);
      return {
        ...Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'documents')),
        business_number: maskedRegistrationNumber(row.business_number),
        expected_vat: expectedVat,
        valid: errors.length === 0,
        validation_message: errors.join(', '),
        issue_status: historyConnected
          ? targetIssueStatus(row, localHistory, remoteDocuments)
          : '발행이력 확인필요',
      };
    });
    res.json({
      provider,
      historyConnected,
      invoices: normalized(invoices),
    });
  } catch (error) { next(error); }
});

router.get('/tax-invoices/provider-check', async (req, res, next) => {
  try {
    const verification = await verifyTaxInvoiceProvider();
    res.json({
      connected: true,
      certificate: verification.certificate,
      corpName: verification.corpInfo?.corpName || '',
    });
  } catch (error) { next(error); }
});

router.post('/tax-invoices/issue-batch', async (req, res, next) => {
  try {
    if (req.body?.confirmation !== 'ISSUE') {
      throw Object.assign(new Error('실제 발행 확인값이 필요합니다.'), { status: 400 });
    }
    const { year, month } = assertDate(`${req.body?.year}.${req.body?.month}`);
    const renterCodes = [...new Set((req.body?.renterCodes || []).map(String))];
    if (renterCodes.length === 0 || renterCodes.length > 100) {
      throw Object.assign(new Error('1건 이상 100건 이하로 선택해 주세요.'), { status: 400 });
    }
    const placeholders = renterCodes.map(() => '?').join(', ');
    const [rows] = await sql.query(
      `SELECT a.key_code AS renter_code, a.name AS renter_name, a.name2 AS representative,
              REPLACE(REPLACE(a.licensenum, '-', ''), ' ', '') AS business_number,
              a.email, a.address,
              COALESCE(b.rent_bill, 0) AS rent_supply,
              COALESCE(b.mng_bill, 0) AS management_supply,
              COALESCE(b.vat_bill, 0) AS base_vat,
              COALESCE(b.other_bill, 0) AS other_supply,
              COALESCE(b.other_vat_bill, 0) AS other_vat,
              COALESCE(b.water_bill, 0) AS water_supply
         FROM jbuildingmng a
         JOIN jbuildingrentbill b ON a.key_code = b.comp_code
        WHERE b.year = ? AND b.month = ? AND a.dealYN = ?
          AND a.key_code IN (${placeholders})`,
      [year, month, 'Y', ...renterCodes],
    );
    if (rows.length !== renterCodes.length) {
      throw Object.assign(new Error('선택한 발행 대상 일부를 찾을 수 없습니다.'), { status: 400 });
    }
    const issueTargets = rows.map((row) => taxDocumentData(row, year, month));
    const invalidTargets = issueTargets
      .map((target) => ({ target, errors: taxTargetValidationErrors(target) }))
      .filter(({ errors }) => errors.length > 0);
    if (invalidTargets.length > 0) {
      throw Object.assign(new Error(invalidTargets
        .map(({ target, errors }) => `${target.renter_name}: ${errors.join(', ')}`)
        .join(' / ')), { status: 400 });
    }
    const remoteDocuments = await listIssuedTaxInvoices({ year, month });
    const alreadyIssued = issueTargets.flatMap((target) => target.documents
      .filter((document) => remoteDocuments.some((remote) => remoteDocumentMatches(target, document, remote)))
      .map((document) => `${target.renter_name}(${document.tax_type})`));
    if (alreadyIssued.length > 0) {
      throw Object.assign(
        new Error(`이미 발행된 문서가 있어 중단했습니다: ${alreadyIssued.join(', ')}`),
        { status: 409 },
      );
    }

    const entries = issueTargets.flatMap((target) => target.documents.map((document) => ({
      target,
      document,
      documentKey: makeDocumentKey({
        year,
        month,
        renterCode: target.renter_code,
        documentType: document.document_type,
      }),
    })));
    try {
      await reserveTaxInvoiceIssues(year, month, entries);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        throw Object.assign(new Error('이미 발행했거나 처리 중인 문서가 있어 중단했습니다.'), { status: 409 });
      }
      throw error;
    }

    const results = await issueTaxInvoices({ issueTargets: entries });
    await Promise.all(results.map(updateTaxInvoiceIssue));
    const successCount = results.filter((result) => result.success).length;
    const failed = results.filter((result) => !result.success);
    res.json({
      accepted: failed.length === 0,
      documentCount: entries.length,
      successCount,
      failedCount: failed.length,
      message: failed.length === 0
        ? `${successCount}건 발행이 완료되었습니다.`
        : `${successCount}건 발행, ${failed.length}건 실패했습니다: ${failed.map((result) => result.error.message).join(' / ')}`,
    });
  } catch (error) { next(error); }
});

router.get('/bank/accounts', async (req, res, next) => {
  try {
    const provider = bankProviderStatus();
    if (!provider.configured) return res.status(503).json({ provider, error: `팝빌 설정값이 없습니다: ${provider.missing.join(', ')}` });
    const accounts = await listBankAccounts();
    res.json({ provider, accounts });
  } catch (error) { next(error); }
});

router.post('/bank/collections', async (req, res, next) => {
  try {
    if (req.body?.confirmation !== 'COLLECT') {
      throw Object.assign(new Error('은행 거래내역 수집 확인값이 필요합니다.'), { status: 400 });
    }
    const { startDate, endDate } = assertCollectionRange(req.body?.startDate, req.body?.endDate);
    const collection = await requestBankCollection({
      accountKey: req.body?.accountKey,
      startDate,
      endDate,
    });
    await sql.query(
      `INSERT INTO bank_collection_jobs
         (job_id, account_key, bank_code, account_number_masked, start_date, end_date, status)
       VALUES (?, ?, ?, ?, ?, ?, 'requested')
       ON DUPLICATE KEY UPDATE status = 'requested', error_code = NULL, error_message = NULL`,
      [collection.jobId, req.body.accountKey, collection.bankCode, collection.accountNumberMasked,
        sqlDate(startDate), sqlDate(endDate)],
    );
    res.status(202).json({ jobId: collection.jobId, status: 'collecting' });
  } catch (error) { next(error); }
});

router.get('/bank/collections/:jobId', async (req, res, next) => {
  try {
    const jobId = String(req.params.jobId || '');
    if (!/^\w{18}$/.test(jobId)) throw Object.assign(new Error('수집 작업번호가 올바르지 않습니다.'), { status: 400 });
    const [jobs] = await sql.query('SELECT * FROM bank_collection_jobs WHERE job_id = ? LIMIT 1', [jobId]);
    if (jobs.length === 0) throw Object.assign(new Error('수집 작업을 찾을 수 없습니다.'), { status: 404 });
    const result = await getBankCollection(jobId);
    const state = result.state || {};
    const jobState = Number(state.jobState || 0);
    if (result.failed) {
      const reason = String(state.errorReason || '팝빌 거래내역 수집에 실패했습니다.').slice(0, 500);
      await sql.query(
        "UPDATE bank_collection_jobs SET status = 'failed', error_code = ?, error_message = ? WHERE job_id = ?",
        [String(state.errorCode || ''), reason, jobId],
      );
      return res.status(502).json({ error: `팝빌 거래내역 수집 실패: ${reason}` });
    }
    if (jobState === 3) {
      for (const transaction of result.transactions) {
        const tradeDate = assertCompactDate(transaction.trdate, '거래일');
        const providerTid = String(transaction.tid || crypto.createHash('sha256').update([
          jobId, transaction.trdate, transaction.trserial, transaction.trdt,
          transaction.accIn, transaction.accOut, transaction.balance,
        ].join('|')).digest('hex'));
        await sql.query(
          `INSERT INTO bank_transactions
             (provider, provider_tid, job_id, bank_code, account_number_masked,
              trade_date, trade_datetime, deposit_amount, withdrawal_amount, balance,
              remark1, remark2, remark3, remark4, memo)
           VALUES ('popbill', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             job_id = VALUES(job_id), balance = VALUES(balance), memo = VALUES(memo),
             remark1 = VALUES(remark1), remark2 = VALUES(remark2),
             remark3 = VALUES(remark3), remark4 = VALUES(remark4)`,
          [providerTid, jobId, jobs[0].bank_code, jobs[0].account_number_masked,
            sqlDate(tradeDate), sqlDateTime(transaction.trdt || transaction.trdate),
            Number(transaction.accIn || 0), Number(transaction.accOut || 0), Number(transaction.balance || 0),
            transaction.remark1 || null, transaction.remark2 || null,
            transaction.remark3 || null, transaction.remark4 || null, transaction.memo || null],
        );
      }
      await sql.query("UPDATE bank_collection_jobs SET status = 'completed' WHERE job_id = ?", [jobId]);
      return res.json({ status: 'completed', importedCount: result.transactions.length });
    }
    if (jobState === 4) {
      await sql.query(
        "UPDATE bank_collection_jobs SET status = 'failed', error_code = ?, error_message = ? WHERE job_id = ?",
        [String(state.errorCode || ''), String(state.errorReason || '수집 작업에 실패했습니다.').slice(0, 500), jobId],
      );
      return res.status(502).json({ error: state.errorReason || '팝빌 거래내역 수집 작업에 실패했습니다.' });
    }
    await sql.query("UPDATE bank_collection_jobs SET status = 'collecting' WHERE job_id = ?", [jobId]);
    return res.json({ status: 'collecting', jobState });
  } catch (error) { next(error); }
});

router.get('/bank/transactions', async (req, res, next) => {
  try {
    const { year, month } = assertDate(`${req.query.year}.${req.query.month}`);
    const startDate = `${year}-${month}-01`;
    const nextMonth = new Date(Date.UTC(Number(year), Number(month), 1)).toISOString().slice(0, 10);
    const previous = previousBillingPeriod(year, month);
    const [transactions] = await sql.query(
      `SELECT t.id, t.provider_tid, t.bank_code, t.account_number_masked,
              DATE_FORMAT(t.trade_date, '%Y-%m-%d') AS trade_date,
              DATE_FORMAT(t.trade_datetime, '%Y-%m-%d %H:%i:%s') AS trade_datetime,
              t.deposit_amount, t.withdrawal_amount, t.balance,
              t.remark1, t.remark2, t.remark3, t.remark4, t.memo,
              m.id AS match_id, m.comp_code AS matched_renter_code,
              r.name AS matched_renter_name, m.bill_year, m.bill_month
         FROM bank_transactions t
         LEFT JOIN bank_bill_matches m ON m.bank_transaction_id = t.id
         LEFT JOIN jbuildingmng r ON r.key_code = m.comp_code
        WHERE t.trade_date >= ? AND t.trade_date < ? AND t.deposit_amount > 0
        ORDER BY t.trade_datetime DESC, t.id DESC`,
      [startDate, nextMonth],
    );
    const [bills] = await sql.query(
      `SELECT b.comp_code AS renter_code, r.name AS renter_name,
              b.year AS bill_year, b.month AS bill_month,
              b.rent_bill, b.mng_bill, b.vat_bill, b.water_bill, b.other_bill, b.other_vat_bill
         FROM jbuildingrentbill b
         JOIN jbuildingmng r ON r.key_code = b.comp_code
         LEFT JOIN bank_bill_matches m
           ON m.comp_code = b.comp_code AND m.bill_year = b.year AND m.bill_month = b.month
        WHERE ((b.year = ? AND b.month = ?) OR (b.year = ? AND b.month = ?))
          AND b.finish = 'N' AND m.id IS NULL
        ORDER BY b.year DESC, b.month DESC, r.name`,
      [year, month, previous.year, previous.month],
    );
    const [aliases] = await sql.query('SELECT payer_key, comp_code FROM bank_payer_aliases');
    const aliasMap = new Map(normalizeQueryRows(aliases)
      .map((alias) => [String(alias.payer_key), String(alias.comp_code)]));
    const safeTransactions = normalizeQueryRows(transactions);
    res.json({
      transactions: safeTransactions.map((transaction) => ({
        ...transaction,
        ...(!transaction.match_id
          ? matchCandidates(transaction, bills, { preferredRenterCode: aliasMap.get(payerKey(transaction)) || '' })
          : { candidates: [], suggested: null }),
      })),
      summary: {
        depositCount: safeTransactions.length,
        depositTotal: safeTransactions.reduce((sum, row) => sum + Number(row.deposit_amount || 0), 0),
        matchedCount: safeTransactions.filter((row) => row.match_id).length,
      },
    });
  } catch (error) { next(error); }
});

router.post('/bank/matches', async (req, res, next) => {
  try {
    if (!['MATCH', 'FORCE_MATCH'].includes(req.body?.confirmation)) {
      throw Object.assign(new Error('입금 매칭 확인값이 필요합니다.'), { status: 400 });
    }
    const transactionId = Number(req.body?.transactionId);
    if (!Number.isSafeInteger(transactionId) || transactionId <= 0) throw Object.assign(new Error('거래번호가 올바르지 않습니다.'), { status: 400 });
    const { year, month } = assertDate(`${req.body?.year}.${req.body?.month}`);
    const renterCode = String(req.body?.renterCode || '');
    const match = await sql.transaction(async (query) => {
      const [transactions] = await query(
        `SELECT *, DATE_FORMAT(trade_date, '%Y-%m') AS trade_month
           FROM bank_transactions WHERE id = ? FOR UPDATE`,
        [transactionId],
      );
      const [bills] = await query(
        `SELECT b.*, r.name AS renter_name FROM jbuildingrentbill b
          JOIN jbuildingmng r ON r.key_code = b.comp_code
         WHERE b.comp_code = ? AND b.year = ? AND b.month = ? FOR UPDATE`,
        [renterCode, year, month],
      );
      if (transactions.length === 0 || bills.length === 0) throw Object.assign(new Error('입금내역 또는 청구서를 찾을 수 없습니다.'), { status: 404 });
      const tradeMonth = String(transactions[0].trade_month || '');
      const [tradeYear, tradeMonthNumber] = tradeMonth.split('-');
      const previousTradePeriod = previousBillingPeriod(tradeYear, tradeMonthNumber);
      const requestedPeriod = `${year}-${month}`;
      if (![tradeMonth, `${previousTradePeriod.year}-${previousTradePeriod.month}`].includes(requestedPeriod)) {
        throw Object.assign(new Error('입금 발생월 또는 바로 이전 달 청구서만 매칭할 수 있습니다.'), { status: 409 });
      }
      if (bills[0].finish === 'Y') throw Object.assign(new Error('이미 수납 완료된 청구서입니다.'), { status: 409 });
      const amount = Number(transactions[0].deposit_amount || 0);
      const total = billTotal(bills[0]);
      const forced = amount !== total;
      if (forced && req.body.confirmation !== 'FORCE_MATCH') {
        throw Object.assign(new Error('금액이 다른 청구서는 강제 수동 매칭 확인이 필요합니다.'), { status: 409 });
      }
      const [insert] = await query(
        `INSERT INTO bank_bill_matches
           (bank_transaction_id, comp_code, bill_year, bill_month, matched_amount, match_method)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [transactionId, renterCode, year, month, amount, forced ? 'forced_manual' : 'manual'],
      );
      const learnedPayerKey = payerKey(transactions[0]);
      if (learnedPayerKey) {
        await query(
          `INSERT INTO bank_payer_aliases (payer_key, comp_code, last_transaction_id, match_count)
           VALUES (?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE comp_code = VALUES(comp_code),
             last_transaction_id = VALUES(last_transaction_id), match_count = match_count + 1`,
          [learnedPayerKey, renterCode, transactionId],
        );
      }
      await query("UPDATE jbuildingrentbill SET finish = 'Y' WHERE comp_code = ? AND year = ? AND month = ?", [renterCode, year, month]);
      return { id: insert.insertId, renterName: bills[0].renter_name, amount, billTotal: total, forced };
    });
    res.status(201).json({ match });
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') error = Object.assign(new Error('해당 입금 또는 청구서는 이미 매칭되어 있습니다.'), { status: 409 });
    next(error);
  }
});

router.post('/bank/matches/:matchId/cancel', async (req, res, next) => {
  try {
    if (req.body?.confirmation !== 'CANCEL') throw Object.assign(new Error('입금 매칭 취소 확인값이 필요합니다.'), { status: 400 });
    const matchId = Number(req.params.matchId);
    await sql.transaction(async (query) => {
      const [matches] = await query(
        `SELECT m.*, t.remark1 FROM bank_bill_matches m
          JOIN bank_transactions t ON t.id = m.bank_transaction_id
         WHERE m.id = ? FOR UPDATE`,
        [matchId],
      );
      if (matches.length === 0) throw Object.assign(new Error('취소할 매칭을 찾을 수 없습니다.'), { status: 404 });
      const match = matches[0];
      await query('DELETE FROM bank_bill_matches WHERE id = ?', [matchId]);
      const learnedPayerKey = payerKey(match);
      if (learnedPayerKey) {
        await query('DELETE FROM bank_payer_aliases WHERE payer_key = ? AND comp_code = ?', [learnedPayerKey, match.comp_code]);
      }
      await query("UPDATE jbuildingrentbill SET finish = 'N' WHERE comp_code = ? AND year = ? AND month = ?", [match.comp_code, match.bill_year, match.bill_month]);
    });
    res.json({ cancelled: true });
  } catch (error) { next(error); }
});

router.get('/vat/status', (req, res) => {
  res.json(vatProviderStatus());
});

router.get('/vat/provider-check', async (req, res, next) => {
  try {
    const provider = vatProviderStatus();
    if (!provider.configured) {
      return res.status(503).json({
        error: `팝빌 설정값이 없습니다: ${provider.missing.join(', ')}`,
        provider,
      });
    }
    const readiness = await verifyVatProvider();
    return res.json({ provider, ...readiness });
  } catch (error) {
    return next(error);
  }
});

router.post('/vat/collections', async (req, res, next) => {
  try {
    if (req.body?.confirmation !== 'COLLECT') {
      throw Object.assign(new Error('국세청 자료 수집 확인값이 필요합니다.'), { status: 400 });
    }
    const collection = await requestVatCollection({
      startDate: req.body?.startDate,
      endDate: req.body?.endDate,
    });
    res.status(202).json({
      ...collection,
      status: 'collecting',
      message: '국세청 자료 수집을 요청했습니다.',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/vat/collections/status', async (req, res, next) => {
  try {
    const collection = await getVatCollection(req.body?.jobs);
    res.json(collection);
  } catch (error) {
    next(error);
  }
});

router.use((error, req, res, next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.status ? error.message : '서버 처리 중 오류가 발생했습니다.' });
});

export default router;
