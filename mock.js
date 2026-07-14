import express from 'express';
import cors from 'cors';
import crypto from 'crypto';

const app = express();
const port = Number(process.env.MOCK_PORT || 8003);
const sessions = new Set();

const renters = [
  {
    building_name: '제이빌딩', address: '101호', name: '테스트상가 A', name2: '홍길동',
    licensenum: '123-45-67890', tel: '010-1234-5678', email: 'test-a@example.com', etc: '',
    start_date: '2026.01.01', end_date: '2026.12.31', deposit: '10000000', rent_bill: '1000000',
    mng_bill: '200000', vat_bill: '120000', water_bill: '30000', other_bill: '0',
    other_vat_bill: '0', contract_date: '2026.01.01',
  },
  {
    building_name: '제이빌딩', address: '202호', name: '테스트상가 B', name2: '김관리',
    licensenum: '234-56-78901', tel: '010-2345-6789', email: 'test-b@example.com', etc: '',
    start_date: '2026.02.01', end_date: '2027.01.31', deposit: '15000000', rent_bill: '1500000',
    mng_bill: '250000', vat_bill: '175000', water_bill: '45000', other_bill: '10000',
    other_vat_bill: '1000', contract_date: '2026.02.01',
  },
];

const bills = new Map([
  ['테스트상가 A', { rent_bill: '1000000', mng_bill: '200000', vat_bill: '120000', water_bill: '30000', other_bill: '0', other_vat_bill: '0', etc: '', finish: 'Y' }],
  ['테스트상가 B', { rent_bill: '1500000', mng_bill: '250000', vat_bill: '175000', water_bill: '45000', other_bill: '10000', other_vat_bill: '1000', etc: '', finish: 'N' }],
]);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

function cookie(req, name) {
  return String(req.headers.cookie || '').split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

function requireAuth(req, res, next) {
  if (!sessions.has(cookie(req, 'rent_session'))) return res.status(401).json({ error: '로그인이 필요합니다.' });
  next();
}

app.post('/api/login', (req, res) => {
  if (req.body?.id !== 'demo' || req.body?.password !== 'demo') {
    return res.status(401).json({ error: '테스트 계정은 demo / demo 입니다.' });
  }
  const token = crypto.randomBytes(16).toString('hex');
  sessions.add(token);
  res.setHeader('Set-Cookie', `rent_session=${token}; HttpOnly; SameSite=Lax; Path=/`);
  res.json({ authenticated: true });
});

app.get('/api/session', requireAuth, (req, res) => res.json({ authenticated: true }));
app.post('/api/logout', requireAuth, (req, res) => res.json({ authenticated: false }));

app.get('/api/renters', requireAuth, (req, res) => {
  res.json(renters.map(({ name }) => ({ name })));
});

app.get('/api/renters/:name', requireAuth, (req, res) => {
  const renter = renters.find(({ name }) => name === req.params.name);
  res.json(renter ? [renter] : []);
});

app.post('/api/renters', requireAuth, (req, res) => {
  renters.push(req.body);
  res.status(201).json({ affectedRows: 1 });
});

app.patch('/api/renters/:name', requireAuth, (req, res) => {
  const renter = renters.find(({ name }) => name === req.params.name);
  if (renter) Object.assign(renter, req.body);
  res.json({ affectedRows: renter ? 1 : 0 });
});

app.get('/api/bills', requireAuth, (req, res) => {
  const search = String(req.query.search || '').toLowerCase();
  res.json(renters
    .filter(({ name }) => name.toLowerCase().includes(search))
    .map(({ name }) => ({ name, finish: bills.get(name)?.finish || 'N' })));
});

app.get('/api/bills/:name', requireAuth, (req, res) => {
  const bill = bills.get(req.params.name);
  if (!bill) return res.json([]);
  const value = [{ ...bill, date: String(req.query.date) }];
  res.json(req.query.mode === 'payment' ? value : { exists: true, value });
});

app.post('/api/bills/:name', requireAuth, (req, res) => {
  bills.set(req.params.name, { ...req.body, finish: 'N' });
  res.status(201).json({ affectedRows: 1 });
});

app.patch('/api/bills/:name', requireAuth, (req, res) => {
  bills.set(req.params.name, { ...bills.get(req.params.name), ...req.body });
  res.json({ affectedRows: 1 });
});

app.patch('/api/bills/:name/payment', requireAuth, (req, res) => {
  bills.set(req.params.name, { ...bills.get(req.params.name), finish: req.body.finish });
  res.json({ affectedRows: 1 });
});

app.get('/api/summary', requireAuth, (req, res) => {
  const values = [...bills.values()];
  const chargeFields = ['rent_bill', 'mng_bill', 'vat_bill', 'water_bill', 'other_bill', 'other_vat_bill'];
  const total = values.reduce((sum, bill) => sum + chargeFields
    .reduce((amount, key) => amount + Number(bill[key] || 0), 0), 0);
  const paid = values.filter(({ finish }) => finish === 'Y')
    .reduce((sum, bill) => sum + chargeFields
      .reduce((amount, key) => amount + Number(bill[key] || 0), 0), 0);
  res.json([{ tmoney: String(total), minab: String(paid) }]);
});

app.get('/jbd/getExcelData', requireAuth, (req, res) => {
  if (req.query.kind === 'taxbilldown') return res.json([[], []]);
  res.json(renters.map((renter) => {
    const bill = bills.get(renter.name) || {};
    return {
      날짜: req.query.date, 빌딩명: renter.building_name, 주소: renter.address, 이름: renter.name,
      년: String(req.query.date).slice(0, 4), 월: String(req.query.date).slice(5, 7),
      임대료: bill.rent_bill || 0, 관리비: bill.mng_bill || 0, 부가세: bill.vat_bill || 0,
      수도료: bill.water_bill || 0, 기타요금: bill.other_bill || 0,
      '기타 부가세': bill.other_vat_bill || 0, 합계: 0, 비고: '', 메모: '',
    };
  }));
});

app.listen(port, '0.0.0.0', () => console.log(`rent manager mock API: ${port}`));
