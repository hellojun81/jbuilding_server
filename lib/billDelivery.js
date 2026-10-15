export const deliveryMethods = {
  email: { label: '이메일', channels: ['email'] },
  sms: { label: '문자', channels: ['sms'] },
  kakao: { label: '카카오', channels: ['kakao'] },
  email_sms: { label: '이메일+문자', channels: ['email', 'sms'] },
};
export function validateDeliveryMethod(data) {
  if (!Object.hasOwn(data, 'bill_delivery_method')) return data;
  const method = data.bill_delivery_method;
  if (method !== '' && method !== null && (typeof method !== 'string' || !Object.hasOwn(deliveryMethods, method))) {
    throw Object.assign(new Error('청구서 수신방법을 목록에서 선택해 주세요.'), { status: 400 });
  }
  return { ...data, bill_delivery_method: method || null };
}
// Shared routing contract for a future sender; this function never sends messages.
export function billDeliveryPlan(renter) {
  const method = renter.bill_delivery_method || '';
  const configuration = deliveryMethods[method];
  const email = String(renter.email || '').trim();
  const phone = String(renter.tel || '').replace(/[^\d+]/g, '');
  const recipients = (configuration?.channels || []).map((channel) => ({
    channel,
    recipient: channel === 'email' ? email : phone,
    valid: channel === 'email' ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) : /^(01\d{8,9}|\+821\d{8,9})$/.test(phone),
  }));
  return { method, label: configuration?.label || '미설정', recipients,
    contactReady: Boolean(configuration && recipients.every((item) => item.valid)),
    sendingEnabled: false,
    message: '수신방법만 저장됩니다. 실제 발송은 발송서비스 연동 후 지원됩니다.' };
}
