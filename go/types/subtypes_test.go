package types

// 2026-08-21：shell-leaf 架构（ADR-104/105）已整体移除。
// 资源类型现在是扁平结构（无父子 subtype 关系），每种类型（如 EntityPlayer、
// SceneModel、CustomAnim）都是 resource_types.json 中的独立顶级类型。
// 因此本文件原有的所有 subtype 相关测试已全部删除：
//
//	移除的函数/类型：SubtypesFor, SubtypeByDir, IsSubDirName, SubtypeNames,
//	                 ResourceSubType, IsMMDSubDir, IsSubDirGrouping, MMDSubDirs
//	                 以及 ResourceType.SubTypes 字段
//
// 如需测试新的扁平资源类型体系，请在 resource_test.go 或 extensions_test.go 中编写。
