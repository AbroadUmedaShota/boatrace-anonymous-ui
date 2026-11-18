export function currentManualTarget(value:{date:string;mode:string},now=Date.now()) {
 const offset=value.mode==='BASE_DAY_BEFORE'?86400000:0;
 return value.date===new Date(now+9*3600000+offset).toISOString().slice(0,10);
}
