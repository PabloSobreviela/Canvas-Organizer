import React from "react";
import Paper from "@mui/material/Paper";
import Badge from "@mui/material/Badge";
import { DateCalendar } from "@mui/x-date-pickers/DateCalendar";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { PickersDay } from "@mui/x-date-pickers/PickersDay";
import dayjs from "dayjs";

export default function MiniCalendarSidebar({
  currentMonth,
  zoomedDate,
  onDateSelect,
  onMonthChange,
  getItemsForDate,
}) {
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Paper sx={{ width: 280, flexShrink: 0, p: 1, display: { xs: "none", md: "block" }, alignSelf: "flex-start" }}>
        <DateCalendar
          value={dayjs(zoomedDate || currentMonth)}
          onChange={(newValue) => {
            if (!newValue) return;
            const jsDate = newValue.toDate();
            onDateSelect?.(jsDate);
          }}
          onMonthChange={(newMonth) => {
            if (!newMonth) return;
            onMonthChange?.(newMonth.toDate());
          }}
          slots={{
            day: (dayProps) => {
              const dateObj = dayProps.day.toDate();
              const hasEvents = getItemsForDate(dateObj).length > 0;
              return (
                <Badge
                  key={dayProps.day.toString()}
                  overlap="circular"
                  variant="dot"
                  invisible={!hasEvents}
                  sx={{ "& .MuiBadge-dot": { bgcolor: "#3b82f6", width: 6, height: 6 } }}
                >
                  <PickersDay {...dayProps} />
                </Badge>
              );
            },
          }}
          sx={{
            "& .MuiPickersDay-root": { color: "#d4d4d8", "&:hover": { bgcolor: "#27272a" } },
            "& .MuiPickersDay-root.Mui-selected": { bgcolor: "#2563eb", "&:hover": { bgcolor: "#1d4ed8" } },
            "& .MuiPickersDay-today": { border: "1px solid #3b82f6" },
            "& .MuiDayCalendar-weekDayLabel": { color: "#71717a" },
            "& .MuiPickersCalendarHeader-label": { color: "#e4e4e7" },
            "& .MuiPickersArrowSwitcher-button": { color: "#a1a1aa" },
          }}
        />
      </Paper>
    </LocalizationProvider>
  );
}
