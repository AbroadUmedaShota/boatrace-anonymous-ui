import {assertPredictionUsage,type PredictionMode,type PredictionUsage} from '@boatrace/contracts';

export const modeGuidance:Record<PredictionMode,{required:string;timing:string}>={
 R5_PRE_RACE:{required:'当日の出走表と、展示などの直前情報が必要です。オッズは取得・時点を検証できた場合だけ使用します。',timing:'直前情報が公開されてから、締切までに取得・確認・計算が終わる時点で依頼してください。未公表や欠損がある場合は保留になります。'},
 BASE_SAME_DAY:{required:'当日の出走表を使った基礎予想です。展示などの直前情報や直前オッズは使用しません。',timing:'当日の出走表が公開されてから、締切前に依頼してください。オッズがない場合は分類・配分金額を補いません。'},
 BASE_DAY_BEFORE:{required:'翌日の出走表を使った基礎予想です。展示などの直前情報や直前オッズは使用しません。',timing:'翌日の出走表が公開されてから依頼してください。公式の更新目安は通常開催18時頃、サマータイム20時頃、ナイター22時頃です。会場単位の更新で遅延もあるため、時刻だけで公開済みとは判断しません。未公表や対象不一致は保留になります。'},
};

const jstFormatter=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});

export function formatJstTimestamp(value:unknown):string{
 if(typeof value!=='string')return '未確認';
 const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
 if(!match)return '未確認';
 const [year,month,day,hour,minute,second]=match.slice(1,7).map(Number),zone=match[7];
 const leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(month<1||month>12||day<1||day>days[month-1]||hour>23||minute>59||second>59||zone!=='Z'&&(Number(zone.slice(1,3))>23||Number(zone.slice(4))>59))return '未確認';
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return '未確認';
 const parts=Object.fromEntries(jstFormatter.formatToParts(date).map(part=>[part.type,part.value]));
 return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} JST`;
}

export function parseDailyUsage(value:unknown,day:string):PredictionUsage{
 assertPredictionUsage(value);
 if(value.day!==day||formatJstTimestamp(value.asOf)==='未確認')throw Error('INVALID_CURRENT_PREDICTION_USAGE');
 return value;
}
