import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { RecipeService } from '../../services';
import { RecipeCardComponent } from '../../components';

@Component({
  selector: 'app-favorites',
  standalone: true,
  imports: [CommonModule, RouterLink, RecipeCardComponent],
  templateUrl: './favorites.component.html',
  styleUrls: ['./favorites.component.scss']
})
export class FavoritesComponent {
  private router = inject(Router);
  private recipeService = inject(RecipeService);

  favoriteRecipes = this.recipeService.favoriteRecipes;
  favorites = this.recipeService.favorites;

  onFavoriteToggled(recipeId: string): void {
    this.recipeService.toggleFavorite(recipeId);
  }

  onAddToMealPlan(recipeId: string): void {
    this.router.navigate(['/meal-plan'], { queryParams: { addRecipe: recipeId } });
  }

  navigateToRecipes(): void {
    this.router.navigate(['/recipes']);
  }
}
