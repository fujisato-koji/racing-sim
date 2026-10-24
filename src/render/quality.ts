// 描画の質。自動のときは、フレームの時間を見て描く画素の数を増減する。
import { isTouch } from '../ui/layout';

export type QualityPref = 'auto' | 'low' | 'medium' | 'high';
export type QualityLevel = 'low' | 'medium' | 'high';

export const quality = {
  pref: 'auto' as QualityPref,
  /** 物を作るときの質（車、木の数、塗装の艶） */
  get level(): QualityLevel {
    if (this.pref !== 'auto') return this.pref;
    return isTouch ? 'medium' : 'high';
  },
};
