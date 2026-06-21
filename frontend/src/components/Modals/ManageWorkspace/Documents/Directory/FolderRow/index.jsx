import { useState } from "react";
import { useTranslation } from "react-i18next";
import FileRow from "../FileRow";
import { CaretDown, FolderNotch } from "@phosphor-icons/react";
import { middleTruncate } from "@/utils/directories";

export default function FolderRow({
  item,
  totalItems = 0,
  selected,
  onRowClick,
  toggleSelection,
  isSelected,
  autoExpanded = false,
  indexFolder,
  isEmbeddingActive = false,
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(autoExpanded);

  const handleExpandClick = (event) => {
    event.stopPropagation();
    setExpanded(!expanded);
  };

  return (
    <>
      <tr
        onClick={onRowClick}
        className={`text-theme-text-primary text-xs grid grid-cols-12 py-2 pl-3.5 pr-8 hover:bg-theme-file-picker-hover cursor-pointer file-row ${
          selected ? "selected light:text-white !text-white" : ""
        }`}
      >
        <div
          className={`col-span-6 flex gap-x-[4px] items-center ${
            selected ? "!text-white" : "text-theme-text-primary"
          }`}
        >
          <div
            className={`shrink-0 w-3 h-3 rounded border-[1px] border-solid border-white ${
              selected ? "text-white" : "text-theme-text-primary light:invert"
            } flex justify-center items-center cursor-pointer`}
            role="checkbox"
            aria-checked={selected}
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              toggleSelection(item);
            }}
          >
            {selected && <div className="w-2 h-2 bg-white rounded-[2px]" />}
          </div>
          <div
            onClick={handleExpandClick}
            className={`transform transition-transform duration-200 ${
              expanded ? "rotate-360" : " rotate-270"
            }`}
          >
            <CaretDown className="text-base font-bold w-4 h-4" />
          </div>
          <FolderNotch
            className="shrink-0 text-base font-bold w-4 h-4 mr-[3px]"
            weight="fill"
          />
          <p className="whitespace-nowrap overflow-show max-w-[400px]">
            {middleTruncate(item.name, 35)}
          </p>
          {totalItems > 0 && (
            <span className="text-theme-text-secondary text-[10px] font-medium ml-1.5 shrink-0">
              ({totalItems})
            </span>
          )}
        </div>
        <div className="col-span-6 flex justify-end items-center pr-1">
          <button
            type="button"
            disabled={isEmbeddingActive}
            onClick={(event) => {
              event.stopPropagation();
              indexFolder?.(item.name);
            }}
            className="border-none text-[10px] font-semibold bg-white/10 light:bg-[#E0F2FE] h-[24px] px-2 rounded-md hover:bg-neutral-800/80 hover:text-white light:text-[#026AA2] light:hover:bg-[#026AA2] light:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/10"
          >
            {t("connectors.directory.index-folder")}
          </button>
        </div>
      </tr>
      {expanded && (
        <>
          {item.items.map((fileItem) => (
            <FileRow
              key={fileItem.id}
              item={fileItem}
              selected={isSelected(fileItem.id)}
              toggleSelection={toggleSelection}
            />
          ))}
        </>
      )}
    </>
  );
}
