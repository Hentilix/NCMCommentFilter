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
    checks = {
        "当前账号黑名单接口": ("pub/hybrid/app.chunk.c6406e5.js", b'url:"api/blacklist/get"'),
        "黑名单模块导出": ("pub/hybrid/app.chunk.c6406e5.js", b'd(t,"H",(function(){return Di'),
        "按当前账号 ID 请求": ("pub/hybrid/164.chunk.c6406e5.js", b'yield o(r.H,{userid:e})'),
        "评论卡片标记": ("pub/hybrid/app.chunk.c6406e5.js", b'data-testid":"tid_comment_card"'),
        "回复数据": ("pub/hybrid/app.chunk.c6406e5.js", b'beReplied:V'),
        "专辑页面路由": ("pub/hybrid/57.chunk.c6406e5.js", b'G("/album/:id")'),
    }
    print("仅检查安装包基线 c6406e5；运行时可能使用不同热更新，不能据此判定实时兼容。")
    try:
        with ZipFile(package) as archive:
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
