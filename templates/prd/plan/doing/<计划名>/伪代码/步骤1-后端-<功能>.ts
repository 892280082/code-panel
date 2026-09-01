// 步骤1 · 后端 · {功能}
// 作用：{本文件作用}
// 位置：{代码落地路径}（如 zc-ops/apps/video-compress/src/api/XxxApi.ts）

// ========== ① {第一步：控制器/入口} ==========
import { Autowired, Component, Post, Get, Body, Query } from 'j-spring-web';
import { XxxRep } from '@entity/xxx';

@Component()
export class XxxApi {
  @Autowired()
  xxxRep: XxxRep;

  /**
   * {接口说明}
   * 接口：{POST/GET} /api/xxx
   * 入参：
   *   {字段}   {必填/可选}  {类型}  {说明}
   * 出参：{返回结构}
   * 错误码：{40001 说明} / {40002 说明}
   */
  @Post('/api/xxx')
  async xxx(@Body() body: any) {
    // ① {步骤注释}
    // ② {步骤注释}
    // ③ {步骤注释}
    return { ok: true };
  }

  // ========== ② {第二步} ==========
  @Get('/api/yyy')
  async yyy(@Query('id') id: number) {
    // ① {步骤注释}
    return this.xxxRep.findOneBy({ id });
  }
}
// 出参：{汇总出参}
// 错误码：{40001 参数缺失} / {40002 重复} / ...
// 注意：{关键注意事项}
