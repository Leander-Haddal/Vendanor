const LIMIT = 320000;

export function textLines(value) {
  return String(value || '').replace(/\r/g, '').split(/\n+|(?<=[.!?;])\s+(?=[A-ZÆØÅ0-9(])/u)
    .map(line => line.trim()).filter(Boolean);
}

/** A bounded longest common subsequence, preserving both original wordings. */
export function lineDiff(before, after) {
  const a = textLines(before), b = textLines(after);
  let first = 0, endA = a.length, endB = b.length;
  while (first < endA && first < endB && a[first] === b[first]) first++;
  while (endA > first && endB > first && a[endA-1] === b[endB-1]) { endA--; endB--; }
  const edits = a.slice(0,first).map(text => ({kind:'same',text}));
  const n=endA-first, m=endB-first;
  if (n*m <= LIMIT) {
    const width=m+1, table=new Uint32Array((n+1)*width);
    for(let i=n-1;i>=0;i--) for(let j=m-1;j>=0;j--) {
      table[i*width+j]=a[first+i]===b[first+j]?1+table[(i+1)*width+j+1]:Math.max(table[(i+1)*width+j],table[i*width+j+1]);
    }
    let i=0,j=0;
    while(i<n || j<m) {
      if(i<n && j<m && a[first+i]===b[first+j]) { edits.push({kind:'same',text:a[first+i++]});j++; }
      else if(i<n && (j===m || table[(i+1)*width+j]>=table[i*width+j+1])) edits.push({kind:'del',text:a[first+i++]});
      else edits.push({kind:'add',text:b[first+j++]});
    }
  } else {
    for(const text of a.slice(first,endA)) edits.push({kind:'del',text});
    for(const text of b.slice(first,endB)) edits.push({kind:'add',text});
  }
  for(const text of a.slice(endA)) edits.push({kind:'same',text});
  let left=0,right=0;
  return edits.map(edit => ({...edit,left:edit.kind==='add'?null:++left,right:edit.kind==='del'?null:++right}));
}

function sectionKeys(sections) {
  const counts=new Map();
  return sections.map(section => {
    const base=String(section.matchKey || section.number || section.label || section.id).trim().toLowerCase();
    const occurrence=counts.get(base)||0;
    counts.set(base,occurrence+1);
    return [base+'|'+occurrence,section];
  });
}

export function sectionDiff(before, after) {
  const left=new Map(sectionKeys(before)), right=new Map(sectionKeys(after));
  const keys=new Set([...left.keys(),...right.keys()]);
  return [...keys].map(key => {
    const a=left.get(key),b=right.get(key);
    const kind=!a?'added':!b?'removed':(a.text===b.text && (a.title||'')===(b.title||''))?'unchanged':'changed';
    return {key,before:a,after:b,kind};
  });
}
