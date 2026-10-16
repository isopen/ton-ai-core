import { EndpointError } from 'sdk';
import { TgcloudHelloPlugin } from '../lib/tgcloud-hello/index.js';

export default async function (input, ctx) {
  const plugin = await TgcloudHelloPlugin.armed();
  const current = input && typeof input.current === 'string' ? input.current : '';
  const known = plugin.getLabels();
  if (current !== '' && !known.includes(current)) {
    throw new EndpointError('Unknown label', { code: 'UNKNOWN_LABEL' });
  }
  return { label: plugin.nextLabel(current) };
}
