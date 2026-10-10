import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

// A shared S3 credential must not allow selecting the other environment by mistake.
export function validateTarget(env=process.env) {
  const environment=env.CSCHEAP_DOCS_ENVIRONMENT;
  if(!['staging','prod'].includes(environment))throw new Error('Invalid deployment environment');
  const expected=environment==='staging'?'preview-cscheap-docs':'cscheap-docs';
  if(env.CSCHEAP_DOCS_R2_BUCKET!==expected)throw new Error('R2 bucket does not match the deployment environment');
}

export function r2Store(env=process.env) {
  const required=name=>{const value=env[name];if(!value)throw new Error(`Missing ${name}`);return value;};
  const account=required('CSCHEAP_DOCS_R2_ACCOUNT_ID');
  if(!/^[a-f0-9]{32}$/.test(account))throw new Error('Invalid R2 account ID');
  const Bucket=required('CSCHEAP_DOCS_R2_BUCKET');
  if(!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(Bucket))throw new Error('Invalid bucket name');
  const client=new S3Client({region:'auto',endpoint:`https://${account}.r2.cloudflarestorage.com`,
    credentials:{accessKeyId:required('CSCHEAP_DOCS_R2_ACCESS_KEY_ID'),secretAccessKey:required('CSCHEAP_DOCS_R2_SECRET_ACCESS_KEY')},
    maxAttempts:3,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
  const send=command=>client.send(command,{abortSignal:AbortSignal.timeout(20000)});
  return {
    async get(Key,max){
      let response;
      try{response=await send(new GetObjectCommand({Bucket,Key}));}
      catch(error){if(error.name==='NoSuchKey'||error.$metadata?.httpStatusCode===404)return null;throw new Error(`R2 read failed (${error.name})`);}
      if(response.ContentLength>max){response.Body?.destroy();throw new Error('R2 object exceeds limit');}
      const chunks=[];let size=0;
      try{for await(const part of response.Body){size+=part.length;if(size>max)throw new Error('R2 stream exceeds limit');chunks.push(part);}}
      finally{response.Body?.destroy();}
      return Buffer.concat(chunks);
    },
    async put(Key,Body,ContentType,CacheControl){
      try{await send(new PutObjectCommand({Bucket,Key,Body,ContentType,CacheControl}));}
      catch(error){throw new Error(`R2 write failed (${error.name}); inspect pointer before retrying`);}
    },
    close(){client.destroy();},
  };
}
