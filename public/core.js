/** Helpers without external dependencies; also used in smoke tests. */
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const newId = () => 'n' + Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2,'0')).join('');
export function utf8ToBase64(s) {
  const bytes = new TextEncoder().encode(s); let binary = '';
  for (let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary);
}
export function base64ToUtf8(s) {
  const binary = atob(s); const bytes = new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
export function normalizeNote(n, totalPages) {
  if (!n || !Number.isInteger(n.page) || n.page < 1 || n.page > totalPages) return null;
  return {
    id: /^[a-zA-Z0-9_-]{1,64}$/.test(n.id || '') ? n.id : newId(),
    page: n.page, x: clamp(Number(n.x)||0, 0.02, .98),
    y: clamp(Number(n.y)||0, 0.02, .98),
    title: String(n.title || 'Nota').slice(0,100),
    html: String(n.html || '<p></p>').slice(0,1500000),
    bg: /^#[a-fA-F0-9]{6}$/.test(n.bg||'')?n.bg:'#fffdf4',
    border: /^#[a-fA-F0-9]{6}$/.test(n.border||'')?n.border:'#c7b18a',
    width:clamp(Number(n.width)||340,200,520),
    height:clamp(Number(n.height)||300,170,650),
    // Notes made before 1.5 retain their original generous spacing. New notes
    // explicitly store lineSpacing:1 / paragraphSpacing:0 by default.
    lineSpacing: n.lineSpacing == null ? 1.55 :
      ([1,1.15,1.5,2].includes(Number(n.lineSpacing)) ? Number(n.lineSpacing) : 1),
    paragraphSpacing: n.paragraphSpacing == null ? 8 :
      ([0,4,8].includes(Number(n.paragraphSpacing)) ? Number(n.paragraphSpacing) : 0),
    hover:n.hover!==false, click:n.click!==false
  };
}
export function popupCoordinates(anchorX, anchorTop, pageW, pageH, w, h) {
  const xx = clamp(anchorX-w-12, 6, Math.max(6,pageW-w-6));
  const yy = clamp(pageH-anchorTop-h/2, 6, Math.max(6,pageH-h-6));
  return { x:xx, y:yy };
}
/** JS action installed on icon widgets: Acrobat-only; controlled by named form fields. */
export function makeActions(id, hover, click) {
  const popup = `NPS_${id}_popup`;
  const state = `NPS_${id}_state`;
  const field = `(this.getField(${JSON.stringify(popup)}))`;
  const stateField = `(this.getField(${JSON.stringify(state)}))`;
  const enter = hover ? `var p=${field};if(p){p.display=display.visible;}` : '';
  const exit = hover ? `var p=${field},s=${stateField};if(p&&(!s||s.value!=="1")){p.display=display.hidden;}` : '';
  const down = click ? `var p=${field},s=${stateField};if(p&&s){s.value=(s.value==="1"?"0":"1");p.display=(s.value==="1"?display.visible:display.hidden);}` : '';
  return { enter, exit, down };
}
export function printableName(name) { return (name || 'documento').replace(/\.pdf$/i,'').replace(/[^a-z0-9_áàãâéêíóôõúç -]/gi,'_').slice(0,85) + '_com_notas.pdf'; }

/**
 * Character advances recovered from PDF.js's display operator list.
 * TJ offsets, word/character spacing, horizontal scaling and font widths are
 * counted independently of the browser's fallback font.  These advances are
 * normalized to each TextContent item's *actual* PDF width by the caller.
 * Unsupported/malformed glyphs are not guessed: the caller keeps its fallback.
 */
export function pdfGlyphAdvances(operatorList, OPS) {
  if (!operatorList?.fnArray || !operatorList?.argsArray || !OPS) return [];
  const identity=()=>[1,0,0,1,0,0];
  const product=(m,n)=>[
    m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],
    m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],
    m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]
  ];
  let ctm=identity(),matrix=identity();
  let fontSize=0,wordSpacing=0,charSpacing=0,hScale=1,leading=0,rise=0;
  let x=0,y=0,lineX=0,lineY=0,run=0;
  const output=[],saved=[];
  const nextRun=()=>{run++;};
  const point=(offsetX)=>{
    const xx=matrix[0]*offsetX+matrix[2]*(y+rise)+matrix[4];
    const yy=matrix[1]*offsetX+matrix[3]*(y+rise)+matrix[5];
    return [ctm[0]*xx+ctm[2]*yy+ctm[4],ctm[1]*xx+ctm[3]*yy+ctm[5]];
  };
  const move=(dx,dy)=>{x=lineX+=Number(dx)||0;y=lineY+=Number(dy)||0;nextRun();};
  const show=glyphs=>{
    if(!Array.isArray(glyphs))return;
    for(const glyph of glyphs){
      if(typeof glyph==='number'){
        x+=(-glyph*fontSize/1000)*hScale;
        continue;
      }
      if(glyph===null){x+=wordSpacing*hScale;continue;}
      if(!glyph||typeof glyph!=='object')continue;
      const text=typeof glyph.unicode==='string'?glyph.unicode:'';
      const w=Number(glyph.width);
      if(!text||!Number.isFinite(w)||!Number.isFinite(fontSize))continue;
      const width=w*fontSize/1000*hScale;
      const advance=width+(charSpacing+(glyph.isSpace?wordSpacing:0))*hScale;
      if(!Number.isFinite(width)||!Number.isFinite(advance)||width<0)continue;
      const count=text.length;
      for(let j=0;j<count;j++){
        const start=x+width*j/count,end=x+width*(j+1)/count;
        const a=point(start),b=point(end);
        output.push({char:text[j],start,end,run,
          x1:a[0],x2:b[0],baseline:a[1],approximate:count>1});
      }
      x+=advance;
    }
  };
  for(let i=0;i<operatorList.fnArray.length;i++){
    const op=operatorList.fnArray[i],args=operatorList.argsArray[i]||[];
    if(op===OPS.save){saved.push({ctm:ctm.slice(),fontSize,wordSpacing,charSpacing,hScale,leading,rise});}
    else if(op===OPS.restore){
      const state=saved.pop();if(state){({ctm,fontSize,wordSpacing,charSpacing,hScale,leading,rise}=state);}
    }
    else if(op===OPS.transform && args.length===6)ctm=product(ctm,args);
    else if(op===OPS.paintFormXObjectBegin){
      saved.push({ctm:ctm.slice(),fontSize,wordSpacing,charSpacing,hScale,leading,rise});
      if(Array.isArray(args[0])&&args[0].length===6)ctm=product(ctm,args[0]);
    }
    else if(op===OPS.paintFormXObjectEnd){
      const state=saved.pop();if(state){({ctm,fontSize,wordSpacing,charSpacing,hScale,leading,rise}=state);}
    }
    else if(op===OPS.beginText){matrix=identity();x=y=lineX=lineY=0;nextRun();}
    else if(op===OPS.setTextMatrix && args.length===6){matrix=args.slice();x=y=lineX=lineY=0;nextRun();}
    else if(op===OPS.moveText)move(args[0],args[1]);
    else if(op===OPS.setLeadingMoveText){leading=-(Number(args[1])||0);move(args[0],args[1]);}
    else if(op===OPS.setLeading)leading=Number(args[0])||0;
    else if(op===OPS.nextLine)move(0,-leading);
    else if(op===OPS.setFont)fontSize=Math.abs(Number(args[1])||0);
    else if(op===OPS.setWordSpacing)wordSpacing=Number(args[0])||0;
    else if(op===OPS.setCharSpacing)charSpacing=Number(args[0])||0;
    else if(op===OPS.setHScale)hScale=(Number(args[0])||100)/100;
    else if(op===OPS.setTextRise)rise=Number(args[0])||0;
    else if(op===OPS.showText||op===OPS.showSpacedText)show(args[0]);
    else if(op===OPS.nextLineShowText){move(0,-leading);show(args[0]);}
    else if(op===OPS.nextLineSetSpacingShowText){
      wordSpacing=Number(args[0])||0;charSpacing=Number(args[1])||0;
      move(0,-leading);show(args[2]);
    }
  }
  return output;
}

/**
 * Align a TextContent item with the Unicode glyphs in painting order.
 * Returns glyph-accurate fractional bounds per UTF-16 unit only when the
 * entire non-whitespace text has an unambiguous match within a single run.
 * Whitespace that PDF.js inferred from positioning uses the real geometric
 * gap between its neighboring glyphs instead of a browser-space width.
 */
export function matchPdfGlyphGeometry(text, glyphs, from=0, itemX=null, itemWidth=null, itemY=null) {
  if (!text || !Array.isArray(glyphs) || !glyphs.length) return null;
  const norm = ch => ch === '\u00a0' ? ' ' : ch;
  const space = ch => /\s/u.test(norm(ch));
  const prefix=[...text].filter(ch=>!space(ch)).slice(0,5).map(norm);
  if(!prefix.length)return null;
  // Require a short sequence, not merely the first letter.  Repeated §/Art.
  // prefixes are common and otherwise could bind the wrong paragraph.
  let i=-1;
  for(let candidate=from;candidate<Math.min(glyphs.length,from+200);candidate++){
    if(norm(glyphs[candidate].char)!==prefix[0])continue;
    let g=candidate,matched=0,skips=0;
    for(const ch of prefix){
      while(g<glyphs.length&&space(glyphs[g].char)&&skips<8){g++;skips++;}
      if(g>=glyphs.length||norm(glyphs[g].char)!==ch)break;
      matched++;g++;
    }
    if(matched===prefix.length){i=candidate;break;}
  }
  if(i<0)return null;
  const starts=new Array(text.length),ends=new Array(text.length),
    absStarts=new Array(text.length),absEnds=new Array(text.length);
  let g=i,firstMatched=-1,lastMatched=-1,skipped=0,nonspace=0;
  for(let k=0;k<text.length;k++){
    const ch=norm(text[k]);
    if(space(ch)){
      if(g<glyphs.length&&space(glyphs[g].char)){
        const cell=glyphs[g];starts[k]=cell.start;ends[k]=cell.end;
        absStarts[k]=cell.x1;absEnds[k]=cell.x2;g++;
      }else{starts[k]=ends[k]=absStarts[k]=absEnds[k]=null;}
      continue;
    }
    nonspace++;
    while(g<glyphs.length&&space(glyphs[g].char)&&skipped<8){g++;skipped++;}
    if(g>=glyphs.length||norm(glyphs[g].char)!==ch)return null;
    const cell=glyphs[g];
    if(firstMatched<0)firstMatched=g;
    lastMatched=g;
    starts[k]=cell.start;ends[k]=cell.end;
    absStarts[k]=cell.x1;absEnds[k]=cell.x2;
    g++;
  }
  if(nonspace<1||firstMatched<0||lastMatched<0)return null;
  if(glyphs.slice(firstMatched,g).some(t=>t.approximate))return null;
  const sameRun=glyphs.slice(firstMatched,g).every(t=>t.run===glyphs[firstMatched].run);
  // The full PDF CTM and text matrices allow characters from distinct BT/Tm
  // runs to be joined, as happens in PDFs exported from Google Docs.
  const absolute=Number.isFinite(itemX)&&Number.isFinite(itemWidth)&&itemWidth>0&&
    absStarts.every((n,k)=>n===null||Number.isFinite(n)&&Number.isFinite(absEnds[k]));
  let useAbsolute=false;
  if(absolute){
    const printed=glyphs.slice(firstMatched,g).filter(t=>!space(t.char));
    const baseline=printed[0]?.baseline;
    const minX=Math.min(...printed.map(t=>t.x1));
    const maxX=Math.max(...printed.map(t=>t.x2));
    // Sanity-check source coordinates against the exact TextContent item.
    // Corrupt/rotated/form-ambiguous text deliberately falls back.
    const tolerance=Math.max(2,itemWidth*.035);
    useAbsolute=printed.every(t=>Number.isFinite(t.baseline)&&Math.abs(t.baseline-baseline)<1.5&&t.x2>=t.x1)&&
      Math.abs(minX-itemX)<tolerance&&Math.abs(maxX-(itemX+itemWidth))<Math.max(3,itemWidth*.075);
    if(Number.isFinite(itemY)&&Number.isFinite(baseline))useAbsolute=useAbsolute&&Math.abs(baseline-itemY)<4;
  }
  if(!useAbsolute&&!sameRun)return null;
  let positionsStart=useAbsolute?absStarts:starts;
  let positionsEnd=useAbsolute?absEnds:ends;
  for(let k=0;k<text.length;k++){
    if(positionsStart[k]!=null)continue;
    let p=k-1,n=k+1;
    while(p>=0&&positionsEnd[p]==null)p--;
    while(n<text.length&&positionsStart[n]==null)n++;
    if(p>=0&&n<text.length){
      const count=n-p-1,step=(positionsStart[n]-positionsEnd[p])/count;
      positionsStart[k]=positionsEnd[p]+step*(k-p-1);positionsEnd[k]=positionsStart[k]+step;
    }else if(p>=0){positionsStart[k]=positionsEnd[p];positionsEnd[k]=positionsEnd[p];}
    else if(n<text.length){positionsStart[k]=positionsStart[n];positionsEnd[k]=positionsStart[n];}
  }
  const base=useAbsolute?itemX:positionsStart.find(Number.isFinite);
  const extent=useAbsolute?itemWidth:positionsEnd[positionsEnd.length-1]-base;
  if(!Number.isFinite(base)||!Number.isFinite(extent)||extent<=.01)return null;
  if(positionsStart.some(v=>!Number.isFinite(v))||positionsEnd.some(v=>!Number.isFinite(v)))return null;
  if(positionsStart.some((v,k)=>positionsEnd[k]<v-.01 ||k>0&&v<positionsStart[k-1]-.05))return null;
  return {starts:positionsStart.map(v=>clamp((v-base)/extent,0,1)),
    ends:positionsEnd.map(v=>clamp((v-base)/extent,0,1)),next:g,
    exact:useAbsolute};
}
