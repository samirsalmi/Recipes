import { Component, input, output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-search-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './search-bar.component.html',
  styleUrls: ['./search-bar.component.scss']
})
export class SearchBarComponent {
  placeholder = input<string>('Search recipes...');
  value = input<string>('');
  
  searchChanged = output<string>();
  cleared = output<void>();

  onInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchChanged.emit(target.value);
  }

  onClear(): void {
    this.cleared.emit();
  }
}
