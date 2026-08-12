// ===== go/avatar 路径守卫补测（isSafeAvatarPath P1 修复无测试）=====
// 覆盖：反斜杠归一化 / .. 逃逸拒绝 / avatar/ 精确前缀 / 裸文件名兼容 /
// 非 avatar 前缀拒绝 / Windows 保留设备名 SafeName 边界。
package avatar

import (
	"testing"
)

func TestIsSafeAvatarPath(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want bool
	}{
		{"avatar 目录本身", "avatar", true},
		{"avatar 内文件", "avatar/alice.png", true},
		{"avatar 内子目录", "avatar/sub/bob.png", true},
		{"裸文件名归一化", "alice.png", true},
		{"Windows 反斜杠合法路径", `avatar\alice.png`, true},
		{"Windows 反斜杠逃逸", `avatar\..\x.png`, false},
		{"正斜杠 .. 逃逸", "avatar/../x.png", false},
		{"双 .. 逃逸", "avatar/../../etc/passwd", false},
		{"非 avatar 前缀目录", "avatars/alice.png", false},
		{"avatarx 前缀", "avatarx/alice.png", false},
		{"外部目录", "models/alice.png", false},
		{"纯 .. 段", "..", false},
		{"空串", "", false},
		{"avatar/ 尾斜杠", "avatar/", true},
		{"大小写不敏感", "Avatar/Alice.PNG", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := isSafeAvatarPath(c.in); got != c.want {
				t.Errorf("isSafeAvatarPath(%q) = %v, 期望 %v", c.in, got, c.want)
			}
		})
	}
}

func TestSafeName_WindowsReservedDevice(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"CON", "_CON"},
		{"con.png", "_con.png"},
		{"COM1.config", "_COM1.config"},
		{"CON.Doe", "_CON.Doe"},
		{"NUL", "_NUL"},
		{"PRN", "_PRN"},
		{"AUX", "_AUX"},
		{"LPT9", "_LPT9"},
		{"正常名字", "正常名字"},
		{"a/b", "a_b"},
		{"尾部空格. ", "尾部空格"},
	}
	for _, c := range cases {
		t.Run(c.in, func(t *testing.T) {
			if got := SafeName(c.in); got != c.want {
				t.Errorf("SafeName(%q) = %q, 期望 %q", c.in, got, c.want)
			}
		})
	}
}
