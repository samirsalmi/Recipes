import { Component, input, output, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Recipe } from '../../models';
import { RecipeService } from '../../services';
import { optimizeImage } from '../../utils/image-url';
import { ImagePlaceholderComponent } from '../ui/image-placeholder/image-placeholder.component';

@Component({
  selector: 'app-recipe-card',
  standalone: true,
  imports: [CommonModule, ImagePlaceholderComponent],
  templateUrl: './recipe-card.component.html',
  styleUrls: ['./recipe-card.component.scss']
})
export class RecipeCardComponent {
  private router = inject(Router);
  private recipeService = inject(RecipeService);

  recipe = input.required<Recipe>();
  isFavorite = input<boolean>(false);
  viewMode = input<'grid' | 'list'>('grid');
  
  favoriteToggled = output<string>();
  addToMealPlan = output<string>();

  imageError = false;

  optimizedImage(): string {
    return optimizeImage(this.recipe().image, 600);
  }

  handleImageError(): void {
    this.imageError = true;
  }

  getDifficultyColor(): string {
    const difficulty = this.recipe().difficulty;
    switch (difficulty) {
      case 'Easy': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
      case 'Medium': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
      case 'Hard': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
    }
  }

  getCategoryColor(): string {
    const category = this.recipe().category;
    switch (category) {
      case 'Breakfast': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300';
      case 'Lunch': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
      case 'Dinner': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300';
      case 'Dessert': return 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300';
      case 'Snacks': return 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
    }
  }

  onFavoriteClick(event: Event): void {
    event.stopPropagation();
    this.favoriteToggled.emit(this.recipe().id);
  }

  onAddToMealPlanClick(event: Event): void {
    event.stopPropagation();
    this.addToMealPlan.emit(this.recipe().id);
  }

  onCardClick(): void {
    this.router.navigate(['/recipes', this.recipe().id]);
  }

  formatTime(minutes: number): string {
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
}
