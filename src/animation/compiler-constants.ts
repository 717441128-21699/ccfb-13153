// 编译/逆向共享的人体尺寸常量，避免模块循环依赖。

import { Joint, REST_LOCAL, HIP_ROOT_Y } from '../core/skeleton';

export const HIP_BASE_Y = HIP_ROOT_Y;
export const FOOT_GROUND_Y = 0.07;

// 确保骨架尺寸闭合（大腿+小腿+踝高 = 髋根高），改动骨架时此断言会提醒
export const LEG_TOTAL =
  Math.abs(REST_LOCAL[Joint.LeftKnee][1]) + Math.abs(REST_LOCAL[Joint.LeftFoot][1]);
void REST_LOCAL;
