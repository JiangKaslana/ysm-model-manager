// ===== 统一容器桥接层（ADR-068）=====
// 收敛 ysm/geometry/avatar/packs 各自独立的"打开容器→找条目"实现（调研实测
// zip.OpenReader 10 处 / zip.NewReader 6 处 / sevenzip 5 处重复）。本包统一
// 提供 Entry/Reader 抽象：zip/7z/目录都是"条目列表 + 按名读取"，调用方只需
// 写一次内容物解析，解包免费。
//
// 边界：本包只做"容器打开 + 条目枚举 + 条目读取"，不做大小限制（读取时由
// 调用方用 fsutil.ReadLimitedEntry / types.MaxReadLimit 施加，与现状一致）；
// YSM 加密二进制的前置 wasm 解密不属于容器层（解密产物 zip 再进本包）。
package container

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/bodgit/sevenzip"
)

// Entry 统一容器条目（zip.File / sevenzip.File / 目录文件）。
type Entry interface {
	Name() string // 正斜杠名（zip/7z 原样；目录版为相对路径转正斜杠）
	IsDir() bool
	UncompressedSize64() uint64 // 条目未压缩大小（zip/7z 原值；目录版取 FileInfo.Size 的绝对值）
	Open() (io.ReadCloser, error)
}

// Reader 容器读取器。
type Reader interface {
	Entries() []Entry
	Close() error
}

// ---------------------------------------------------------------------------
// zip 容器

type zipEntry struct{ f *zip.File }

func (e zipEntry) Name() string               { return e.f.Name }
func (e zipEntry) IsDir() bool                { return e.f.FileInfo().IsDir() }
func (e zipEntry) UncompressedSize64() uint64 { return e.f.UncompressedSize64 }
func (e zipEntry) Open() (io.ReadCloser, error) {
	return e.f.Open()
}

type zipContainer struct {
	rc *zip.ReadCloser
	r  *zip.Reader
}

func (c *zipContainer) Entries() []Entry {
	src := c.r
	if src == nil {
		src = &c.rc.Reader
	}
	out := make([]Entry, 0, len(src.File))
	for _, f := range src.File {
		out = append(out, zipEntry{f})
	}
	return out
}

func (c *zipContainer) Close() error {
	if c.rc != nil {
		return c.rc.Close()
	}
	return nil
}

// ---------------------------------------------------------------------------
// 7z 容器

type sevenzipEntry struct{ f *sevenzip.File }

func (e sevenzipEntry) Name() string               { return e.f.Name }
func (e sevenzipEntry) IsDir() bool                { return e.f.FileInfo().IsDir() }
func (e sevenzipEntry) UncompressedSize64() uint64 { return e.f.UncompressedSize }
func (e sevenzipEntry) Open() (io.ReadCloser, error) {
	return e.f.Open()
}

type sevenzipContainer struct {
	r  *sevenzip.Reader
	rc *sevenzip.ReadCloser
}

func (c *sevenzipContainer) Entries() []Entry {
	out := make([]Entry, 0, len(c.r.File))
	for _, f := range c.r.File {
		out = append(out, sevenzipEntry{f})
	}
	return out
}

func (c *sevenzipContainer) Close() error {
	if c.rc != nil {
		return c.rc.Close()
	}
	return nil
}

// ---------------------------------------------------------------------------
// 目录容器（已解压格式：ReadPackMeta/ReadShaderpackLang 的 dir 分支可迁移）

type dirEntry struct {
	rel  string
	path string
	info fs.FileInfo
}

func (e dirEntry) Name() string { return e.rel }
func (e dirEntry) IsDir() bool  { return e.info.IsDir() }
func (e dirEntry) UncompressedSize64() uint64 {
	if e.info == nil {
		return 0
	}
	s := uint64(e.info.Size())
	return s
}
func (e dirEntry) Open() (io.ReadCloser, error) {
	return os.Open(e.path)
}

// ---------------------------------------------------------------------------
// 打开入口

// Open 按扩展名分派打开容器（.zip → zip、.7z → sevenzip、目录 → dir）。
func Open(path string) (Reader, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("container: 打开 %s: %w", path, err)
	}
	if info.IsDir() {
		return openDir(path)
	}
	switch strings.ToLower(filepath.Ext(path)) {
	case ".zip":
		return OpenZipPath(path)
	case ".7z":
		return Open7zPath(path)
	}
	return nil, fmt.Errorf("container: 不支持的容器格式: %s", filepath.Ext(path))
}

// OpenZipPath 按路径打开 zip 容器。
func OpenZipPath(path string) (Reader, error) {
	rc, err := zip.OpenReader(path)
	if err != nil {
		return nil, err
	}
	return &zipContainer{rc: rc}, nil
}

// OpenZipBytes 从内存打开 zip 容器。
func OpenZipBytes(data []byte, size int64) (Reader, error) {
	r, err := zip.NewReader(bytes.NewReader(data), size)
	if err != nil {
		return nil, err
	}
	return &zipContainer{r: r}, nil
}

// Open7zPath 按路径打开 7z 容器。
func Open7zPath(path string) (Reader, error) {
	rc, err := sevenzip.OpenReader(path)
	if err != nil {
		return nil, err
	}
	return &sevenzipContainer{r: &rc.Reader, rc: rc}, nil
}

// Open7zBytes 从内存打开 7z 容器。
func Open7zBytes(data []byte, size int64) (Reader, error) {
	r, err := sevenzip.NewReader(bytes.NewReader(data), size)
	if err != nil {
		return nil, err
	}
	return &sevenzipContainer{r: r}, nil
}

// openDir 目录容器：WalkDir 收集相对路径条目（正斜杠）。
func openDir(root string) (Reader, error) {
	rootAbs := filepath.Clean(root)
	var entries []Entry
	err := filepath.WalkDir(rootAbs, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if p == rootAbs {
			return nil
		}
		rel, rerr := filepath.Rel(rootAbs, p)
		if rerr != nil {
			return nil
		}
		info, ierr := d.Info()
		if ierr != nil {
			return nil
		}
		entries = append(entries, dirEntry{
			rel:  filepath.ToSlash(rel),
			path: p,
			info: info,
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &dirContainer{root: rootAbs, entries: entries}, nil
}

type dirContainer struct {
	root    string
	entries []Entry
}

func (c *dirContainer) Entries() []Entry { return c.entries }
func (c *dirContainer) Close() error     { return nil }

// OpenDir 打开目录容器（导出，供已解压资源包/光影包分支）。
func OpenDir(root string) (Reader, error) {
	return openDir(root)
}

// ZipMatchesEntries 打开 zip 容器并枚举条目名，任一命中 match 即返回 true。
// 打开失败（含损坏 zip / 非 zip 路径）一律返回 false——调用方据此把坏包/
// 不含目标指纹的 zip 安全排除，绝不误判为某类型资源（同步推送/拉取链路
// 据此避免把纯打包物或坏包当模型搬运）。match 接收小写条目名（与
// types.ResourceType.MatchZipEntry 内部 ToLower 幂等一致）。
func ZipMatchesEntries(path string, match func(string) bool) bool {
	if !strings.EqualFold(filepath.Ext(path), ".zip") {
		return false
	}
	rc, err := OpenZipPath(path)
	if err != nil {
		return false
	}
	defer rc.Close()
	for _, e := range rc.Entries() {
		if match(strings.ToLower(e.Name())) {
			return true
		}
	}
	return false
}
