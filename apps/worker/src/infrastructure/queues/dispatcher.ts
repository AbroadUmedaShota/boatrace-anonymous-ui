import {assertComputeDispatchRequest, type ComputeDispatchRequest} from '../../../../../packages/contracts/src/compute-dispatch';
import {strictJson} from '../../modules/access/strict-json';

// Await the producer receipt; an unknown send outcome is never retried here.
export async function queuesDispatch(request: Request, queue: Queue<ComputeDispatchRequest>) {
  const value = strictJson(await request.text());
  assertComputeDispatchRequest(value);
  await queue.send(value, {contentType:'json'});
  return new Response('{"accepted":true}', {status:202,headers:{'Content-Type':'application/json'}});
}
