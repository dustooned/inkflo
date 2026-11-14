import type { ReduceChoice } from '../io/bookassets';
import { confirmDialog } from './dom';

/** Ask before reducing an oversized image; the original file is never changed. */
export const askToReduce: ReduceChoice = (source, to) => confirmDialog(
  'Reduce this image?',
  `It is ${source.width} × ${source.height} px, more than a book can hold (8192 px or 16 megapixels). inkflo can store a working copy at ${to.width} × ${to.height} px. Your original file stays unchanged on your device, so you can re-import or use it elsewhere at full size.`,
  `Reduce to ${to.width} × ${to.height}`);
