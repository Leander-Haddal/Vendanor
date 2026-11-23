export function countryCode(value,countries) {
  const v=String(value||'').toUpperCase();
  return countries.find(c=>c.code===v||c.alpha3===v||c.name.toUpperCase()===v)?.code||v;
}
