/**
 * MCP Project Map Server
 *
 * MCP 服务端点，提供项目结构扫描、关键文件分析、技术栈检测和架构规则提取功能。
 * 通过 stdio 传输层与 MCP 客户端通信。
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { SCAN_STRUCTURE_TOOL, handleScan } from "./scan.js";
import { ANALYZE_KEY_FILES_TOOL, handleAnalyzeKeyFiles } from "./analyze-files.js";
import { DETECT_STACK_TOOL, handleDetectStack } from "./detect-stack.js";
import { EXTRACT_ARCH_PATTERNS_TOOL, handleExtractArchPatterns } from "./arch-patterns.js";
import { findPackageClaudeMds } from "./resources.js";
import fs from "node:fs";

// ==================== 服务端初始化 ====================

const server = new Server(
  { name: "project-map-server", version: "1.0.0" },
  { capabilities: { tools: {}, resources: {} } }
);

// ==================== Tool Handlers ====================

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [SCAN_STRUCTURE_TOOL, ANALYZE_KEY_FILES_TOOL, DETECT_STACK_TOOL, EXTRACT_ARCH_PATTERNS_TOOL],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "scan_structure":
      return await handleScan(args ?? {});
    case "analyze_key_files":
      return await handleAnalyzeKeyFiles(args ?? {});
    case "detect_stack":
      return handleDetectStack(args ?? {});
    case "extract_arch_patterns":
      return await handleExtractArchPatterns(args ?? {});
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// ==================== Resource Handlers ====================

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const packages = findPackageClaudeMds();
  return {
    resources: packages.map(p => ({
      uri: p.uri,
      name: p.name,
      mimeType: "text/markdown",
      description: `${p.name.replace("/CLAUDE.md", "")} 包的架构地图`,
    })),
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  const packages = findPackageClaudeMds();
  const matched = packages.find(p => p.uri === uri);

  if (!matched) {
    throw new Error(`Resource not found: ${uri}`);
  }

  const content = fs.readFileSync(matched.filePath, "utf-8");

  return {
    contents: [{
      uri,
      mimeType: "text/markdown",
      text: content,
    }],
  };
});

// ==================== 启动 ====================

const transport = new StdioServerTransport();
await server.connect(transport);
