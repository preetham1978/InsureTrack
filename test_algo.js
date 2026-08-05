function soundex(s) {
  if (!s) return "";
  let a = s.toLowerCase().split(''),
      f = a.shift(),
      r = '',
      codes = { a: '', e: '', i: '', o: '', u: '', b: 1, f: 1, p: 1, v: 1, c: 2, g: 2, j: 2, k: 2, q: 2, s: 2, x: 2, z: 2, d: 3, t: 3, l: 4, m: 5, n: 5, r: 6 };
  f = f ? f.toUpperCase() : '';
  r = f + a.map(v => codes[v] || codes[v] === 0 ? codes[v] : '').join('').replace(/(.)\1+/g, '$1').replace(/0/g, '');
  return (r + '0000').slice(0, 4);
}
console.log(soundex("Prasad"));
