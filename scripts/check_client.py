"""Read-only compatibility check for the installed NetEase client package."""

import sys
from pathlib import Path
from zipfile import ZipFile


DEFAULT_PACKAGE = Path(r"C:\Program Files\NetEase\CloudMusic\package\orpheus.ntpk")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    package = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PACKAGE
    if not package.is_file():
        print(f"未找到客户端资源包：{package}")
        return 1
    try:
        with ZipFile(package) as archive:
            app_files = [name for name in archive.namelist()
                         if name.startswith("pub/hybrid/app.chunk.") and name.endswith(".js")]
            if len(app_files) != 1:
                print("无法唯一识别客户端主资源文件")
                return 1
            resource_version = app_files[0].split(".")[-2]
            profile = {
                "c6406e5": ("H", "Di", 164, 57),
                "1482700000000": ("K", "Hi", 168, 58),
            }.get(resource_version)
            if not profile:
                print(f"未验证的安装包资源版本：{resource_version}")
                return 1
            export, function, blacklist_chunk, album_chunk = profile

            def chunk(name):
                return f"pub/hybrid/{name}.chunk.{resource_version}.js"

            checks = {
                "当前账号黑名单接口": (chunk("app"), f'{function}=Object(o.a)({{url:"api/blacklist/get"'.encode()),
                "黑名单模块导出": (chunk("app"), f'd(t,"{export}",(function(){{return {function}'.encode()),
                "按当前账号 ID 请求": (chunk(blacklist_chunk), f'yield o(r.{export},{{userid:e}})'.encode()),
                "评论卡片标记": (chunk("app"), b'data-testid":"tid_comment_card"'),
                "回复数据": (chunk("app"), b'beReplied:V'),
                "专辑页面路由": (chunk(album_chunk), b'G("/album/:id")'),
                "单曲评论线程路径": (chunk("app"), b'"R_SO_4_".concat(e)'),
                "单曲评论页面标记": (chunk(74), b'data-testid":"tid_comment_page"'),
                "单曲评论卡片组件": (chunk(74), b'I=n(439)'),
            }
            print(f"检查安装包基线 {resource_version}；运行时可能使用不同热更新，不能据此判定实时兼容。")
            for label, (name, signature) in checks.items():
                passed = signature in archive.read(name)
                print(f"{'通过' if passed else '不匹配'}：{label}")
                if not passed:
                    return 1
    except (OSError, KeyError, ValueError) as error:
        print(f"无法检查资源包：{error}")
        return 1
    print("静态结构符合目标版本；仍需在登录后的客户端验证接口返回和实际页面。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
