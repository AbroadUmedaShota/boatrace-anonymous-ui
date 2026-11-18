import { useEffect, useRef, type ReactNode } from 'react';

export default function ActionConfirmation({ title, children, pending, onConfirm, onCancel }: {
  title: string; children: ReactNode; pending: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);
  return <dialog ref={dialog} className="confirmation-dialog" aria-labelledby="confirmation-title" onCancel={event => { event.preventDefault(); if (!pending) onCancel(); }}>
    <h2 id="confirmation-title">{title}</h2>{children}<div className="confirmation-actions"><button type="button" className="secondary" disabled={pending} onClick={onCancel} autoFocus>キャンセル</button><button id="confirm-admin-action" type="button" disabled={pending} onClick={onConfirm}>{pending ? '保存状態を確認中…' : 'この内容で変更する'}</button></div>
    {pending && <p role="status" className="operation-status">処理中です。自動再送は行いません。</p>}
  </dialog>;
}
