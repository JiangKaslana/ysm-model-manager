package cli

import (
	"fmt"
	"os"
	"runtime"
	"time"

	"ysm-model-manager/internal/app"
)

// Bridge Wails ↔ CLI 桥接服务
// 作为独立 Wails 服务注册，避免 internal/app → go/cli 循环导入
type Bridge struct {
	App *app.App
}

// ExecuteCLI 执行 CLI 命令并返回 JSON 响应（Wails 绑定）
// 前端调用: await window.Bridge.ExecuteCLI(command, args)
func (b *Bridge) ExecuteCLI(command string, args map[string]interface{}) string {
	start := time.Now()

	if !IsCommandAllowed(command) {
		return NewJsonNotSupported(command, "该命令未开放给前端调用").ToJson()
	}

	var cmdArgs []string

	filesRoot := ""
	if fr, ok := args["filesRoot"].(string); ok {
		filesRoot = fr
	}
	if filesRoot == "" {
		filesRoot = b.App.GetYSMRepoRoot()
	}
	if filesRoot != "" {
		cmdArgs = append(cmdArgs, "--files-root", filesRoot)
	}

	cmdArgs = append(cmdArgs, command)

	for k, v := range args {
		if k == "filesRoot" {
			continue
		}
		switch val := v.(type) {
		case string:
			if val != "" {
				cmdArgs = append(cmdArgs, "--"+k, val)
			}
		case float64:
			if val != 0 {
				if val == float64(int64(val)) {
					cmdArgs = append(cmdArgs, "--"+k, fmt.Sprintf("%d", int64(val)))
				} else {
					cmdArgs = append(cmdArgs, "--"+k, fmt.Sprintf("%g", val))
				}
			}
		case bool:
			if val {
				cmdArgs = append(cmdArgs, "--"+k)
			}
		}
	}

	outputBuf, restoreStdout := captureStdout()
	defer restoreStdout()

	err := ExecuteCLIWithApp(b.App, b.App.SaveAppConfig, cmdArgs)
	elapsed := float64(time.Since(start).Milliseconds())

	if err != nil {
		return NewJsonError(command, err, elapsed).ToJson()
	}

	return NewJsonSuccess(command, map[string]interface{}{
		"output":    outputBuf.String(),
		"lines":     splitLines(outputBuf.String()),
		"platform":  runtime.GOOS,
		"filesRoot": filesRoot,
	}, elapsed).ToJson()
}

// captureStdout 捕获 stdout 输出
func captureStdout() (*outputBuffer, func()) {
	orig := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	buf := &outputBuffer{}
	go func() {
		buf.readFrom(r)
	}()

	return buf, func() {
		w.Close()
		os.Stdout = orig
	}
}

// outputBuffer 输出缓冲区
type outputBuffer struct {
	data []byte
	done chan struct{}
}

func (b *outputBuffer) readFrom(r *os.File) {
	buf := make([]byte, 4096)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			b.data = append(b.data, buf[:n]...)
		}
		if err != nil {
			break
		}
	}
	close(b.done)
}

func (b *outputBuffer) String() string {
	if b.done != nil {
		<-b.done
	}
	return string(b.data)
}

// splitLines 将字符串按行分割
func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			line := s[start:i]
			if len(line) > 0 {
				lines = append(lines, line)
			}
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}
