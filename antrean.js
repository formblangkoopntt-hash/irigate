/* ═══ ANTREAN OFFLINE IRIGATE ═══ */
var IDB_NAME='irigate-db', IDB_STORE='antrean', flushing=false;

function isNetErr(e){
  var m=(e&&e.message)?e.message:String(e||''), n=e&&e.name;
  return !navigator.onLine||n==='TypeError'||n==='AbortError'||n==='SyntaxError'||
    /Failed to fetch|NetworkError|Load failed|network|aborted/i.test(m);
}

/* — IndexedDB — */
function idb(){return new Promise(function(res,rej){
  var r=indexedDB.open(IDB_NAME,1);
  r.onupgradeneeded=function(){r.result.createObjectStore(IDB_STORE,{keyPath:'id'})};
  r.onsuccess=function(){res(r.result)};r.onerror=function(){rej(r.error)};
})}
function idbTx(mode,fn){return idb().then(function(db){return new Promise(function(res,rej){
  var tx=db.transaction(IDB_STORE,mode),out=fn(tx.objectStore(IDB_STORE));
  tx.oncomplete=function(){res(out&&out.result!==undefined?out.result:undefined)};
  tx.onerror=function(){rej(tx.error)};
})})}
function qPut(it){return idbTx('readwrite',function(s){return s.put(it)})}
function qDel(id){return idbTx('readwrite',function(s){return s.delete(id)})}
function qAll(){return idbTx('readonly',function(s){return s.getAll()}).then(function(x){return x||[]})}

/* — Masukkan ke antrean — */
function antreSimpan(kind,payload,ids){
  payload.adminPin='';   // jangan simpan PIN di perangkat; server memakai peran dari sesi
  var it={
    id:'q'+Date.now(),kind:kind,owner:SES.kode,status:'menunggu',pesan:'',dibuat:Date.now(),
    label:(kind==='06'?'06-O ':'08-O ')+selDI+' · '+(kind==='06'?payload.namaBangunan:payload.namaBendung)+' · '+new Date().toLocaleDateString('id-ID'),
    payload:payload,
    photos:ids.filter(function(i){return media[i]&&!media[i].url}).map(function(i){
      return{id:i,b64:media[i].b64,name:media[i].name,mime:media[i].mime}})
  };
  return qPut(it).then(function(){
    toast('Tersimpan di HP. Akan dikirim otomatis saat ada internet.','success');
    updAntreanBar();selesaiSimpan();
  }).catch(function(){toast('Gagal menyimpan ke perangkat. Ruang penyimpanan penuh?','error')});
}

/* — Tempel URL foto hasil upload ke payload — */
function hariKirim(p){return new Date(p.diambilPada).getDate()}
function patchFoto(it,id,url){
  var p=it.payload,m6=/^tma6_(\d+)$/.exec(id),m8=/^tma8_(limpas|kanan|kiri)_(\d+)$/.exec(id);
  if(m6){
    var d=+m6[1];p.dailyData[d-1].fotoTma=url;
    if(d===hariKirim(p))p.fotoUrl=url;
  }else if(m8){
    var pt=m8[1],d2=+m8[2],key={limpas:'limpasF',kanan:'kananF',kiri:'kiriF'}[pt];
    p.dailyData[d2-1][key]=url;
    if(d2===hariKirim(p)){
      p['foto'+pt.charAt(0).toUpperCase()+pt.slice(1)]=url;
      if(pt==='limpas')p.fotoUrl=url;
    }
  }
}

/* — Kirim satu item: foto dulu, lalu data — */
function kirimSatu(it,cb){
  var fn=it.kind==='06'?'saveFormData':'saveFormData08O';
  function gagal(e){
    if(isNetErr(e))return cb('jaringan');
    it.status='ditolak';it.pesan=(e&&e.message)||'Gagal';cb('tolak');
  }
  function hasil(r){
    if(r&&r.success)return true;
    var msg=(r&&r.message)||'Ditolak server';
    if(/Sesi berakhir/.test(msg)){cb('sesi');return false}
    it.status='ditolak';it.pesan=msg;cb('tolak');return false;
  }
  function kirimData(){
    it.payload.token=SES.token;
    google.script.run.withSuccessHandler(function(r){if(hasil(r))cb('ok')})
      .withFailureHandler(gagal)[fn](it.payload);
  }
  (function foto(){
    var f=it.photos[0];
    if(!f)return kirimData();
    google.script.run.withSuccessHandler(function(r){
      if(!hasil(r))return;
      patchFoto(it,f.id,r.url);it.photos.shift();
      qPut(it).then(foto);   // simpan kemajuan agar foto tidak diunggah dua kali
    }).withFailureHandler(gagal).uploadPhoto(f.b64,f.name,f.mime,SES.token);
  })();
}

/* — Kirim seluruh antrean milik akun yang sedang login — */
function kirimAntrean(manual){
  if(flushing||!SES)return;
  if(!navigator.onLine){if(manual)toast('Belum ada koneksi internet.','error');return}
  flushing=true;
  qAll().then(function(all){
    var list=all.filter(function(x){return x.owner===SES.kode&&x.status==='menunggu'})
      .sort(function(a,b){return a.dibuat-b.dibuat});
    var i=0,terkirim=0;
    (function next(){
      if(i>=list.length){
        flushing=false;updAntreanBar();
        if(terkirim)toast(terkirim+' data antrean berhasil dikirim.','success');
        return;
      }
      var it=list[i++];
      kirimSatu(it,function(r){
        if(r==='ok'){terkirim++;qDel(it.id).then(next)}
        else if(r==='tolak'){qPut(it).then(next)}
        else if(r==='sesi'){
          flushing=false;sessClear();SES=null;
          qa('.view').forEach(function(v){v.classList.remove('active')});
          $('loginView').classList.add('active');
          toast('Sesi berakhir. Masuk kembali, antrean akan dikirim otomatis.','error');
        }else{flushing=false;updAntreanBar()}   // jaringan putus: coba lagi nanti
      });
    })();
  }).catch(function(){flushing=false});
}

/* — Kartu antrean di menu utama — */
function antreHapus(id){
  if(!confirm('Hapus data antrean ini dari HP? Data tidak akan dikirim.'))return;
  qDel(id).then(updAntreanBar);
}
function updAntreanBar(){
  var old=$('antreanBox');if(old)old.remove();
  if(!SES)return;
  qAll().then(function(all){
    var list=all.filter(function(x){return x.owner===SES.kode});
    if(!list.length)return;
    var h='<div class="card" id="antreanBox"><div class="ct">Antrean Pengiriman ('+list.length+')</div>'+
      list.map(function(x){
        return'<div class="note" style="margin-bottom:.5rem">'+esc(x.label)+' — '+
          (x.status==='ditolak'
            ?'<b style="color:#B91C1C">Ditolak server: '+esc(x.pesan)+'</b> <button class="btn-c" onclick="antreHapus(\''+x.id+'\')">Hapus</button>'
            :'menunggu dikirim')+'</div>'}).join('')+
      '<div class="nb"><span></span><button class="btn btn-sub" onclick="kirimAntrean(true)">Kirim Sekarang</button></div></div>';
    $('menuBox').insertAdjacentHTML('beforebegin',h);
  });
}

/* — Pemicu pengiriman — */
window.addEventListener('online',function(){kirimAntrean()});
setInterval(function(){kirimAntrean()},60000);
