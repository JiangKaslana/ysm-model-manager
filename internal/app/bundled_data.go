package app

// loadBundledData 读取内嵌数据文件（编译期 embed，随 exe 版本走）。
// 2026-08 起纯 exe 发布：zip 不再附带数据 JSON、updater 不再覆盖 exe 旁文件，
// 故不再从 exe 旁/上级目录读取；用户可编辑数据（creators/workshop 系列）
// 走用户目录优先 + 本函数内嵌 fallback。
// resourceFS 为零值时 ReadFile 返回错误（等价于未注入），由调用方处理。
func loadBundledData(name string) ([]byte, error) {
	return resourceFS.ReadFile(name)
}
