import { Injectable, signal, computed, inject } from '@angular/core';
import { Collection } from '../models';
import { StorageService } from './storage.service';
import { RecipeService } from './recipe.service';

@Injectable({
  providedIn: 'root'
})
export class CollectionService {
  private storageService = inject(StorageService);
  private recipeService = inject(RecipeService);

  private collectionsSignal = signal<Collection[]>([]);

  readonly collections = this.collectionsSignal.asReadonly();

  constructor() {
    this.loadCollections();
  }

  private loadCollections(): void {
    this.storageService.getCollections().subscribe(collections => {
      this.collectionsSignal.set(collections || []);
    });
  }

  // Collection CRUD operations
  createCollection(name: string, description?: string, emoji?: string, color?: string): Collection {
    const newCollection: Collection = {
      id: this.generateId(),
      name,
      description,
      emoji,
      color,
      recipeIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.collectionsSignal.update(collections => [...collections, newCollection]);
    this.saveCollections();
    return newCollection;
  }

  updateCollection(id: string, updates: Partial<Collection>): void {
    this.collectionsSignal.update(collections =>
      collections.map(collection =>
        collection.id === id
          ? { ...collection, ...updates, updatedAt: new Date().toISOString() }
          : collection
      )
    );
    this.saveCollections();
  }

  deleteCollection(id: string): void {
    this.collectionsSignal.update(collections => collections.filter(c => c.id !== id));
    this.saveCollections();
  }

  getCollectionById(id: string): Collection | undefined {
    return this.collectionsSignal().find(c => c.id === id);
  }

  // Recipe collection operations
  addRecipeToCollection(collectionId: string, recipeId: string): void {
    this.collectionsSignal.update(collections =>
      collections.map(collection =>
        collection.id === collectionId && !collection.recipeIds.includes(recipeId)
          ? { ...collection, recipeIds: [...collection.recipeIds, recipeId], updatedAt: new Date().toISOString() }
          : collection
      )
    );
    this.saveCollections();
  }

  removeRecipeFromCollection(collectionId: string, recipeId: string): void {
    this.collectionsSignal.update(collections =>
      collections.map(collection =>
        collection.id === collectionId
          ? { ...collection, recipeIds: collection.recipeIds.filter(id => id !== recipeId), updatedAt: new Date().toISOString() }
          : collection
      )
    );
    this.saveCollections();
  }

  getRecipesInCollection(collectionId: string) {
    const collection = this.getCollectionById(collectionId);
    if (!collection) return [];
    return this.recipeService.getRecipesByIds(collection.recipeIds);
  }

  isRecipeInCollection(collectionId: string, recipeId: string): boolean {
    const collection = this.getCollectionById(collectionId);
    return collection ? collection.recipeIds.includes(recipeId) : false;
  }

  // Get collections containing a recipe
  getCollectionsForRecipe(recipeId: string): Collection[] {
    return this.collectionsSignal().filter(c => c.recipeIds.includes(recipeId));
  }

  private saveCollections(): void {
    this.storageService.setCollections(this.collectionsSignal()).subscribe();
  }

  private generateId(): string {
    return `collection_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
