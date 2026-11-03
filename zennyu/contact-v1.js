(()=>{
  const CFG=window.ZENNEWS_CONFIG;
  const form=document.querySelector('#contact-form');
  const status=document.querySelector('#contact-status');
  if(!form||!CFG)return;

  function setStatus(text,type=''){
    status.textContent=text;
    status.className=`contact-status ${type}`.trim();
  }

  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const submit=form.querySelector('button[type="submit"]');
    const data=new FormData(form);
    const payload={
      project_code:'zennyu',
      inquiry_type:String(data.get('inquiry_type')||'other'),
      name:String(data.get('name')||'').trim(),
      email:String(data.get('email')||'').trim(),
      subject:String(data.get('subject')||'').trim(),
      message:String(data.get('message')||'').trim(),
      target_url:String(data.get('target_url')||'').trim(),
      company:String(data.get('company')||'').trim()
    };

    submit.disabled=true;
    setStatus('送信しています…');
    try{
      const res=await fetch(`${CFG.supabaseUrl}/functions/v1/project-inbox-submit`,{
        method:'POST',
        headers:{apikey:CFG.publishableKey,'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      });
      const result=await res.json().catch(()=>({ok:false}));
      if(!res.ok||!result.ok){
        const msg=result.reason==='invalid_email'?'メールアドレスを確認してください。':result.reason==='missing_fields'?'メールアドレスとお問い合わせ内容を入力してください。':result.reason==='rate_limited'?'短時間に複数回送信されています。10分ほど時間をおいてから再度お試しください。':'送信できませんでした。少し時間をおいて再度お試しください。';
        throw new Error(msg);
      }
      form.reset();
      setStatus('お問い合わせを受け付けました。内容を確認のうえ、必要に応じてご連絡します。','ok');
    }catch(err){
      setStatus(err?.message||'送信できませんでした。','error');
    }finally{
      submit.disabled=false;
    }
  });
})();
