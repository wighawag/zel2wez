import * as fs from "node:fs";
import { parse } from "kdljs";

interface Command {
  command?: string;
  args?: string[];
  name?: string;
}

interface Pane extends Command {
  split_direction?: string;
  panes?: Pane[];
}

function generateWezTermConfig(inputFile: string, outputFile: string) {
  // Read the KDL file
  const kdlContent = fs.readFileSync(inputFile, "utf8");

  // Parse KDL
  const parseResult = parse(kdlContent);

  if (!parseResult.errors.length) {
    const layoutNode = parseResult.output?.find(
      (node) => node.name === "layout"
    );

    if (!layoutNode) {
      console.error("No layout node found in KDL file");
      return;
    }

    // Convert KDL to pane structure
    const rootPane: Pane = {
      panes: [],
    };

    // Process children of layout node
    processChildren(layoutNode.children, rootPane);

    // Generate Lua code
    const luaCode = generateLuaCode(rootPane);

    // Write to output file
    fs.writeFileSync(outputFile, luaCode);
    console.log(`Generated WezTerm config at ${outputFile}`);
  } else {
    console.error("Error parsing KDL:", parseResult.errors);
  }
}

function processChildren(nodes: any[], parentPane: Pane, level = 0) {
  for (const node of nodes) {
    if (node.name === "pane") {
      const pane: Pane = {
        split_direction: node.properties.split_direction,
        command: node.properties.command,
        name: node.properties.name,
        panes: [],
      };
      console.log(`${level}: pane`, pane);

      if (pane.command) {
        console.log(JSON.stringify(node, null, 2));
        // Process args if any
        const argsNode = node.children.find(
          (child: any) => child.name === "args"
        );
        if (argsNode) {
          pane.args = argsNode.values;
        }
      }

      // Process child panes
      const childPanes = node.children.filter(
        (child: any) => child.name === "pane"
      );
      if (childPanes.length > 0) {
        processChildren(childPanes, pane, level + 1);
      }

      if (!parentPane.panes) {
        parentPane.panes = [];
      }
      parentPane.panes.push(pane);
    }
  }
}

function generateLuaCode(rootPane: Pane): string {
  let lua = `local wezterm = require 'wezterm'
local mux = wezterm.mux

wezterm.on('gui-startup', function(cmd)
  local tab, pane, window
  
  tab, pane, window = mux.spawn_window {
    cwd = cmd.args[1]
  }
  tab:set_title 'dgame'
  window:set_title 'dgame'

  wezterm.log_warn(cmd.args[1])

`;

  // Generate pane splits
  if (rootPane.panes && rootPane.panes.length > 0) {
    // We need to process panes in reverse order to match the expected layout
    const rootPanes = [...rootPane.panes].reverse();

    // First pane is always the main pane
    const mainPane = rootPanes[0];

    // Process remaining panes
    for (let i = 1; i < rootPanes.length; i++) {
      const paneGroup = rootPanes[i];
      if (paneGroup.panes && paneGroup.panes.length > 0) {
        // Process in reverse to match the split layout
        const panes = [...paneGroup.panes].reverse();

        // First pane in the group
        const firstPane = panes[0];
        lua += generatePaneSplit("pane", firstPane, "Bottom");

        let prevPaneVar = `pane_${sanitizeName(firstPane.name || "unnamed")}`;

        // Remaining panes in the group
        for (let j = 1; j < panes.length; j++) {
          lua += generatePaneSplit(prevPaneVar, panes[j], "Right");
          prevPaneVar = `pane_${sanitizeName(panes[j].name || "unnamed_" + j)}`;
        }
      }
    }
  }

  lua += `
end)


config = {}

-- fix windows in virtualbox
config.prefer_egl=true

return config
`;

  return lua;
}

function generatePaneSplit(
  parentVar: string,
  pane: Pane,
  direction: string
): string {
  const paneVar = `pane_${sanitizeName(pane.name || "unnamed")}`;
  let code = `  -- we create a new horizontal pane\n`;
  code += `  local ${paneVar} = ${parentVar}:split {\n`;

  if (pane.command) {
    if (pane.args && pane.args.length > 0) {
      code += `    args = {'${pane.command}', ${pane.args
        .map((arg) => `'${arg}'`)
        .join(", ")}},\n`;
    } else {
      code += `    args = {'${pane.command}'},\n`;
    }
  }

  code += `    direction = '${direction}'\n`;
  code += `  }\n`;

  return code;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
}

// Example usage
const inputFile = process.argv[2] || "layout.kdl";
const outputFile = process.argv[3] || "wezterm.lua";

generateWezTermConfig(inputFile, outputFile);
