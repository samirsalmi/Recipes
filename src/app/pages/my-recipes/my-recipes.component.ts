import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { RecipeService, ToastService } from '../../services';
import { Recipe } from '../../models';

@Component({
  selector: 'app-my-recipes',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './my-recipes.component.html'
})
export class MyRecipesComponent implements OnInit {
  private recipeService = inject(RecipeService);
  private toastService = inject(ToastService);

  recipes = signal<Recipe[]>([]);
  isLoading = signal(true);

  ngOnInit(): void {
    this.recipeService.loadMyRecipes().subscribe(recipes => {
      this.recipes.set(recipes);
      this.isLoading.set(false);
    });
  }

  toggleVisibility(recipe: Recipe): void {
    this.recipeService.updateRecipe(recipe.id, { isPublic: !recipe.isPublic }).subscribe(updated => {
      this.recipes.update(recipes => recipes.map(r => (r.id === updated.id ? updated : r)));
    });
  }

  parentName(recipe: Recipe): string | undefined {
    if (!recipe.parentRecipeId) return undefined;
    return this.recipeService.getRecipeById(recipe.parentRecipeId)?.name;
  }

  deleteRecipe(recipe: Recipe): void {
    if (!confirm(`Delete "${recipe.name}"? This can't be undone.`)) return;
    this.recipeService.deleteRecipe(recipe.id).subscribe(() => {
      this.recipes.update(recipes => recipes.filter(r => r.id !== recipe.id));
      this.toastService.show('Recipe deleted.');
    });
  }
}
