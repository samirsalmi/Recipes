import { Component, input, output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

@Component({
  selector: 'app-filter-chips',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './filter-chips.component.html',
  styleUrls: ['./filter-chips.component.scss']
})
export class FilterChipsComponent {
  options = input.required<FilterOption[]>();
  selectedValues = input<string[]>([]);
  label = input<string>('');
  multiSelect = input<boolean>(true);
  
  selectionChanged = output<string[]>();

  isSelected(value: string): boolean {
    return this.selectedValues().includes(value);
  }

  toggleSelection(value: string): void {
    const current = this.selectedValues();
    let newSelection: string[];

    if (this.multiSelect()) {
      if (current.includes(value)) {
        newSelection = current.filter(v => v !== value);
      } else {
        newSelection = [...current, value];
      }
    } else {
      newSelection = current.includes(value) ? [] : [value];
    }

    this.selectionChanged.emit(newSelection);
  }
}
