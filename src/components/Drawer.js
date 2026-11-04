import React, { useEffect, useRef } from 'react';
import Icon from './Icon';
export default function Drawer({ title, onClose, children, side = 'right' }) {
  const dialog = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current.querySelector('button').focus();
    const handleKey = event => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const elements = [...dialog.current.querySelectorAll('a[href], button:not([disabled]), input, select, [tabindex="0"]')];
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', handleKey); if (previousFocus && previousFocus.isConnected) previousFocus.focus(); };
  }, [onClose]);
  return <div className="drawer-backdrop" onClick={onClose}><section ref={dialog} className={`drawer drawer-${side}`} role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}><div className="drawer-header"><h2>{title}</h2><button type="button" className="icon-button" aria-label={`Close ${title}`} onClick={onClose}><Icon name="close" /></button></div><div className="drawer-body">{children}</div></section></div>;
}
