import {
  File,
  FileDoc,
  FilePdf,
  FileText,
  FileXls,
} from "@phosphor-icons/react";
import { getFileExtension } from "@/utils/directories";

const ICON_MAP = {
  PDF: { Icon: FilePdf, className: "text-red-400" },
  DOC: { Icon: FileDoc, className: "text-blue-400" },
  DOCX: { Icon: FileDoc, className: "text-blue-400" },
  XLS: { Icon: FileXls, className: "text-green-400" },
  XLSX: { Icon: FileXls, className: "text-green-400" },
  TXT: { Icon: FileText, className: "text-zinc-400" },
  MD: { Icon: FileText, className: "text-zinc-400" },
};

export default function FileTypeIcon({ filename, size = 12, className = "" }) {
  const extension = getFileExtension(filename);
  const config = ICON_MAP[extension] ?? { Icon: File, className: "opacity-60" };
  const { Icon, className: colorClass } = config;

  return (
    <Icon
      size={size}
      weight="fill"
      className={`shrink-0 ${colorClass} ${className}`}
    />
  );
}
