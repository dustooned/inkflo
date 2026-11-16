import { canInstall, install, isInstalled, offlineState, onOfflineChange } from '../app/offline';
import { h, toast } from './dom';
import { openManual } from './manual';

/** "Use inkflo offline": one dialog with the status, the Install button, and plain steps for each device. */
export function openOfflineDialog(): void {
  const status = h('p', { class: 'note', role: 'status' });
  const installBtn = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
    if (await install()) toast('Installed. Open inkflo from your apps or desktop.');
  } }, 'Install inkflo on this device');
  const refresh = () => {
    const st = offlineState();
    status.textContent = isInstalled()
      ? 'You are using the installed app. It works with no internet.'
      : st === 'ready'
        ? 'Ready: inkflo is saved on this device and will open with no internet.'
        : st === 'preparing'
          ? 'Saving inkflo to this device… keep this page open until this says Ready.'
          : 'Offline use is not available in this window. Open inkflo from its web address (https), not from a file, then try again.';
    installBtn.hidden = !canInstall() || isInstalled();
  };
  refresh();
  const off = onOfflineChange(refresh);
  const steps = (title: string, items: string[]) =>
    h('details', {}, h('summary', {}, title), h('ol', {}, items.map((t) => h('li', {}, t))));
  const d = h('dialog', {},
    h('header', {}, h('h2', {}, 'Use inkflo offline')),
    h('div', { class: 'content' },
      status,
      installBtn,
      steps('Windows or Mac: Chrome or Edge', [
        'Open inkflo once while you are online.',
        'Wait until the message above says Ready.',
        'Click the Install icon at the right end of the address bar (or press Install above).',
        'inkflo now opens from your Start menu, Dock or desktop, with no internet.',
      ]),
      steps('iPad or iPhone: Safari', [
        'Open inkflo once while you are online, and wait for Ready.',
        'Tap the Share button, then Add to Home Screen.',
        'Open inkflo from the new icon on your Home Screen.',
      ]),
      steps('Android or Chromebook: Chrome', [
        'Open inkflo once while you are online, and wait for Ready.',
        'Tap the menu (three dots), then Install app or Add to Home screen.',
      ]),
      h('p', { class: 'note' }, h('strong', {}, 'Your drawings stay on this device. '), 'They are saved in this browser, not on a server. On a shared or lab computer they can disappear when it is reset, so before you leave use ', h('em', {}, 'Export → Export files → Backup → Book file (.inkflo)'), ' and keep the file on a USB stick or cloud drive.'),
      h('p', { class: 'note' }, 'Updates arrive by themselves the next time you open inkflo online.')),
    h('footer', {},
      h('button', { class: 'btn', type: 'button', onclick: () => openManual('offline') }, 'Read the full guide'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => d.close() }, 'Done')));
  d.addEventListener('close', () => { off(); d.remove(); });
  document.body.append(d);
  d.showModal();
}
