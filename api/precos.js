// Funcao de pesquisa de preco no SERVIDOR (sem CORS). Duas fontes oficiais do governo:
//  fonte=pncp    -> Portal Nacional de Contratacoes Publicas (busca por palavra, cobre qualquer item)
//  fonte=painel  -> Painel de Precos, Compras.gov.br (oficial, casa por codigo CATMAT quando o item tem)
// Nao recebe nem guarda dado pessoal: so a descricao do item e a UF. Nada e persistido.

var STOP={de:1,da:1,do:1,com:1,para:1,por:1,tipo:1,und:1,unid:1,cx:1,kg:1,ml:1,lt:1,litro:1,litros:1,pct:1,em:1,no:1,na:1,pacote:1,caixa:1,unidade:1,unidades:1,conforme:1,aquisicao:1,eventual:1,futura:1};
var PKG={folhas:1,folha:1,resma:1,unidade:1,unidades:1,pacote:1,caixa:1,kit:1,jogo:1,litro:1,litros:1,frasco:1,rolo:1,metro:1,metros:1,formato:1,aproximado:1};

function norm(s){ return (s||'').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); }
function hasWord(hay,w){ return new RegExp('(^| )'+w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'($| )').test(hay); }
async function getJson(url){ for(var i=0;i<3;i++){ try{ var r=await fetch(url,{headers:{'Accept':'application/json'}}); if(r.ok) return await r.json(); }catch(e){} } return null; }

function aggregate(fontes){
  var vals=fontes.map(function(p){return Number(p.valor);});
  var s=vals.slice().sort(function(a,b){return a-b;});
  var med0=s.length?(s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2):0;
  var kept=vals.filter(function(v){return !(med0>0&&(v>med0*2.5||v<med0*0.4));}).sort(function(a,b){return a-b;});
  var menor=kept.length?kept[0]:0;
  var media=kept.length?kept.reduce(function(a,b){return a+b;},0)/kept.length:0;
  var mediana=kept.length?(kept.length%2?kept[(kept.length-1)/2]:(kept[kept.length/2-1]+kept[kept.length/2])/2):0;
  return {n:kept.length, menor:menor, media:media, mediana:mediana};
}

async function pncpCandidates(desc, uf){
  uf=(uf||'').toUpperCase().slice(0,2);
  var toks=norm(desc).split(' ').filter(function(w){return w.length>=3 && !STOP[w];});
  if(!toks.length) return {cands:[], core:[]};
  var core=toks.filter(function(t){return !/^[0-9]+$/.test(t) && !PKG[t];}); if(!core.length) core=[toks[0]];
  var sj=await getJson('https://pncp.gov.br/api/search/?q='+encodeURIComponent(desc)+'&tipos_documento=edital&ordenacao=-data&pagina=1&tam_pagina=30&status=todos');
  if(!sj) return {erro:1};
  var items=(sj.items||[]).filter(function(it){return !uf||it.uf===uf;});
  if(!items.length) return {cands:[], core:core};
  var top=items.slice(0,16);
  var itensAll=await Promise.all(top.map(function(it){ return getJson('https://pncp.gov.br/api/pncp/v1/orgaos/'+it.orgao_cnpj+'/compras/'+it.ano+'/'+it.numero_sequencial+'/itens'); }));
  var cands=[];
  itensAll.forEach(function(j,idx){ var it=top[idx]; var arr=(j&&(j.data||j))||[]; (Array.isArray(arr)?arr:[]).forEach(function(x){
    var v=Number(x.valorUnitarioEstimado)||0; if(v<=0) return;
    var dn=norm(x.descricao); if(!hasWord(dn,core[0])) return;
    var strict=core.every(function(t){return hasWord(dn,t);});
    var score=toks.reduce(function(a,t){return a+(hasWord(dn,t)?1:0);},0);
    cands.push({score:score, strict:strict, unid:(x.unidadeMedida||''), catmat:(x.catalogoCodigoItem||null),
      p:{fonte:'PNCP', onde:((it.orgao_nome)||'Órgão')+' ('+((it.municipio_nome)||'')+'/'+(it.uf||'')+')', ref:'https://pncp.gov.br/app/editais/'+it.orgao_cnpj+'/'+it.ano+'/'+it.numero_sequencial, data:(it.data_publicacao_pncp||'').slice(0,10), valor:v.toFixed(2)}});
  }); });
  return {cands:cands, core:core};
}

async function precoPainel(catmat, uf){
  uf=(uf||'').toUpperCase().slice(0,2);
  var j=await getJson('https://dadosabertos.compras.gov.br/modulo-pesquisa-preco/1_consultarMaterial?pagina=1&tamanhoPagina=50&codigoItemCatalogo='+catmat+(uf?'&estado='+uf:''));
  var r=(j&&j.resultado)||[];
  if(!r.length && uf){ j=await getJson('https://dadosabertos.compras.gov.br/modulo-pesquisa-preco/1_consultarMaterial?pagina=1&tamanhoPagina=50&codigoItemCatalogo='+catmat); r=(j&&j.resultado)||[]; }
  if(!r.length) return {n:0, fontes:[], catmat:catmat};
  var fontes=r.filter(function(x){return Number(x.precoUnitario)>0;}).slice(0,8).map(function(x){
    return {fonte:'Painel de Preços (Compras.gov.br)', onde:'Compra federal'+(x.estado?(' / '+x.estado):''), ref:'https://paineldeprecos.planejamento.gov.br', data:(x.dataCompra||'').slice(0,10), valor:Number(x.precoUnitario).toFixed(2)};
  });
  if(!fontes.length) return {n:0, fontes:[], catmat:catmat};
  var agg=aggregate(fontes);
  return Object.assign(agg, {fontes:fontes, catmat:catmat});
}

async function buscar(desc, uf, fonte){
  fonte=(fonte||'pncp').toLowerCase();
  var c=await pncpCandidates(desc, uf);
  if(c.erro) return {erro:1};
  var cands=c.cands||[];
  if(fonte==='painel'){
    var strict=cands.filter(function(x){return x.strict && x.catmat;});
    var catmat=null;
    if(strict.length){ var freq={}; strict.forEach(function(x){freq[x.catmat]=(freq[x.catmat]||0)+1;}); catmat=Object.keys(freq).sort(function(a,b){return freq[b]-freq[a];})[0]; }
    if(!catmat) return {n:0, fontes:[], semCodigo:true};
    return await precoPainel(catmat, uf);
  }
  // PNCP
  var chosen=cands.filter(function(x){return x.strict;}); if(!chosen.length) chosen=cands;
  chosen.sort(function(a,b){return b.score-a.score;});
  var vistos={}, fontes=[];
  chosen.forEach(function(x){ var k=x.p.ref+'|'+x.p.valor; if(!vistos[k]&&fontes.length<8){vistos[k]=1;fontes.push(x.p);} });
  if(!fontes.length) return {n:0, fontes:[]};
  var agg=aggregate(fontes);
  return Object.assign(agg, {fontes:fontes});
}

module.exports = async function(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','public, max-age=86400');
  try{
    var u=new URL(req.url, 'http://x');
    var desc=u.searchParams.get('desc')||'';
    var uf=u.searchParams.get('uf')||'';
    var fonte=u.searchParams.get('fonte')||'pncp';
    if(!desc){ res.statusCode=400; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({erro:'desc obrigatorio'})); return; }
    var out=await buscar(desc, uf, fonte);
    res.statusCode=200; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(out));
  }catch(e){ res.statusCode=200; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({erro:String(e)})); }
};
module.exports.buscar = buscar; // p/ teste local
