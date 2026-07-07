// Importacao de contratos de fontes PUBLICAS, executada no servidor (sem CORS e sem credencial no codigo).
//  fonte=pncp     -> contratos publicados no PNCP (Lei 14.133, art. 94). Funciona para qualquer orgao que publica.
//  fonte=megasoft -> portal de transparencia Megasoft/NucleoGov do municipio. A API do portal EXIGE token
//                    emitido pelo gestor do orgao (tela "Acesso automatizado" do portal). O token vem na
//                    requisicao e NAO e guardado em lugar nenhum.
// Nada e persistido aqui; o front mostra a previa e o servidor logado decide o que grava.

async function getJson(url, headers){
  for(var i=0;i<3;i++){
    try{
      var r=await fetch(url,{headers:Object.assign({'Accept':'application/json'},headers||{})});
      var txt=await r.text();
      try{ return {ok:r.ok, status:r.status, json:JSON.parse(txt)}; }
      catch(e){ return {ok:r.ok, status:r.status, json:null, raw:txt.slice(0,300)}; }
    }catch(e){}
  }
  return {ok:false, status:0, json:null};
}

function dbr(iso){ // yyyy-mm-dd -> dd/mm/yyyy
  var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||'')); return m?(m[3]+'/'+m[2]+'/'+m[1]):'';
}

async function pncpContratos(cnpj, dataInicial, dataFinal){
  cnpj=String(cnpj||'').replace(/\D/g,'');
  if(cnpj.length!==14) return {erro:'Informe o CNPJ do órgão (14 dígitos).'};
  var out=[], pagina=1, total=0;
  while(pagina<=3){
    var u='https://pncp.gov.br/api/consulta/v1/contratos?dataInicial='+dataInicial+'&dataFinal='+dataFinal+'&cnpjOrgao='+cnpj+'&pagina='+pagina+'&tamanhoPagina=50';
    var r=await getJson(u);
    if(!r.ok||!r.json) break;
    total=r.json.totalRegistros||0;
    (r.json.data||[]).forEach(function(x){
      out.push({
        numero: x.numeroContratoEmpenho || x.numeroControlePNCP || '',
        objeto: x.objetoContrato || x.informacaoComplementar || '',
        fornecedor: x.nomeRazaoSocialFornecedor || '',
        valor: Number(x.valorGlobal!=null?x.valorGlobal:(x.valorInicial!=null?x.valorInicial:0))||0,
        vigenciaInicio: dbr(x.dataVigenciaInicio),
        vigenciaFim: dbr(x.dataVigenciaFim),
        assinatura: dbr(x.dataAssinatura),
        controle: x.numeroControlePNCP || x.numeroControlePncp || '',
        fonte: 'PNCP (pncp.gov.br)'
      });
    });
    if(out.length>=total || !(r.json.data||[]).length) break;
    pagina++;
  }
  return {total: total, contratos: out};
}

async function megasoftContratos(host, token){
  host=String(host||'').toLowerCase().replace(/[^a-z0-9-]/g,'');
  if(!host) return {erro:'Informe o endereço do portal (ex.: turvelandia).'};
  if(!token) return {erro:'A API do portal exige token de acesso. Peça ao gestor do órgão o token da tela "Acesso automatizado" do portal de transparência.'};
  var base='https://'+host+'.megasofttransparencia.com.br/api/contratos';
  var tentativas=[
    {u: base+'?acao=relatorio', h:{'X-NucleoGov-Services':'true','Authorization':'Bearer '+token}},
    {u: base+'?acao=relatorio&token='+encodeURIComponent(token), h:{'X-NucleoGov-Services':'true'}},
    {u: base+'?acao=listar', h:{'X-NucleoGov-Services':'true','Authorization':'Bearer '+token}}
  ];
  for(var i=0;i<tentativas.length;i++){
    var r=await getJson(tentativas[i].u, tentativas[i].h);
    if(r.ok && r.json){
      var arr=Array.isArray(r.json)?r.json:(r.json.data||r.json.resultado||r.json.registros||[]);
      if(Array.isArray(arr)&&arr.length){
        var out=arr.slice(0,200).map(function(x){
          return {
            numero: x.numero||x.numero_contrato||x.numeroContrato||'',
            objeto: x.objeto||x.descricao||'',
            fornecedor: x.fornecedor||x.contratado||x.razao_social||'',
            valor: Number(x.valor||x.valor_total||x.valorGlobal||0)||0,
            vigenciaInicio: x.vigencia_inicio||x.data_inicio||'',
            vigenciaFim: x.vigencia_fim||x.data_fim||x.vencimento||'',
            assinatura: x.data_assinatura||'',
            controle: '',
            fonte: 'Portal de transparência ('+host+'.megasofttransparencia.com.br)'
          };
        });
        return {total: out.length, contratos: out, formato:'megasoft'};
      }
      return {erro:'O portal respondeu, mas sem lista de contratos neste formato. Resposta: '+JSON.stringify(r.json).slice(0,200)};
    }
    if(r.json && r.json.message) return {erro:'Portal: '+String(r.json.message).slice(0,220)};
  }
  return {erro:'O portal não respondeu no padrão esperado. Confirme o endereço e o token com o gestor do órgão.'};
}

module.exports = async function(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Content-Type','application/json');
  try{
    var u=new URL(req.url,'http://x');
    var fonte=(u.searchParams.get('fonte')||'pncp').toLowerCase();
    var out;
    if(fonte==='megasoft'){
      out=await megasoftContratos(u.searchParams.get('host'), u.searchParams.get('token'));
    } else {
      var hoje=new Date(); var ini=new Date(hoje.getTime()-365*86400000);
      function ymd(d){ return ''+d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0'); }
      out=await pncpContratos(u.searchParams.get('cnpj'), u.searchParams.get('dataInicial')||ymd(ini), u.searchParams.get('dataFinal')||ymd(hoje));
    }
    res.statusCode=200; res.end(JSON.stringify(out));
  }catch(e){ res.statusCode=200; res.end(JSON.stringify({erro:String(e)})); }
};
module.exports.pncpContratos = pncpContratos; // p/ teste local
